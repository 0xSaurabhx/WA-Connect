// SQLite-Based Multi-Session WhatsApp API Server
// Suppress punycode deprecation warning
process.removeAllListeners('warning');
process.on('warning', (warning) => {
    if (warning.name !== 'DeprecationWarning' || !warning.message.includes('punycode')) {
        console.warn(warning.message);
    }
});

const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrTerminal = require('qrcode-terminal');
const cors = require('cors');
const multer = require('multer');
const mime = require('mime-types');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const session = require('express-session');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite Database
const dbPath = path.join(__dirname, 'whatsapp_sessions.db');
const db = new Database(dbPath);

// Create tables if they don't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        phone TEXT,
        status TEXT DEFAULT 'inactive',
        authenticated INTEGER DEFAULT 0,
        ready INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        connected_at DATETIME,
        last_activity DATETIME
    );

    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        message_id TEXT,
        to_number TEXT,
        content TEXT,
        media_type TEXT,
        file_name TEXT,
        caption TEXT,
        status TEXT DEFAULT 'sent',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions (id)
    );

    CREATE TABLE IF NOT EXISTS qr_codes (
        session_id TEXT PRIMARY KEY,
        qr_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        FOREIGN KEY (session_id) REFERENCES sessions (id)
    );
`);

console.log('📊 SQLite Database initialized successfully');

// Authentication configuration
const AUTH_CONFIG = {
    username: 'ACT',
    password: 'N8<$zydy5Q4KYwC]Zbxm_RWv',
    sessionSecret: process.env.SESSION_SECRET || 'your-super-secret-key-change-this-in-production'
};

// Middleware
app.use(express.json());
app.use(cors());

// Session middleware for authentication
app.use(session({
    secret: AUTH_CONFIG.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session && req.session.authenticated) {
        return next();
    } else {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ 
                success: false, 
                error: 'Authentication required. Please login first.',
                redirectTo: '/login'
            });
        } else {
            return res.redirect('/login');
        }
    }
};

// Public routes (no authentication required)
const publicRoutes = ['/login', '/api/auth/login', '/api/auth/logout'];

// Apply authentication middleware to all routes except public ones
app.use((req, res, next) => {
    if (publicRoutes.includes(req.path) || req.path.startsWith('/login-assets/')) {
        return next();
    }
    requireAuth(req, res, next);
});

app.use(express.static('public'));

// In-memory storage for active WhatsApp clients
const activeClients = new Map();
const sessionQRs = new Map();

// Database helper functions
const dbQueries = {
    // Session queries
    getAllSessions: db.prepare('SELECT * FROM sessions ORDER BY created_at DESC'),
    getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    createSession: db.prepare(`
        INSERT INTO sessions (id, name, description) 
        VALUES (?, ?, ?)
    `),
    updateSession: db.prepare(`
        UPDATE sessions 
        SET name = ?, description = ?, phone = ?, status = ?, 
            authenticated = ?, ready = ?, updated_at = CURRENT_TIMESTAMP,
            connected_at = ?, last_activity = CURRENT_TIMESTAMP
        WHERE id = ?
    `),
    updateSessionStatus: db.prepare(`
        UPDATE sessions 
        SET status = ?, authenticated = ?, ready = ?, 
            phone = ?, connected_at = ?, updated_at = CURRENT_TIMESTAMP,
            last_activity = CURRENT_TIMESTAMP
        WHERE id = ?
    `),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    
    // QR code queries
    saveQR: db.prepare(`
        INSERT OR REPLACE INTO qr_codes (session_id, qr_data, expires_at) 
        VALUES (?, ?, datetime('now', '+5 minutes'))
    `),
    getQR: db.prepare('SELECT * FROM qr_codes WHERE session_id = ? AND expires_at > datetime(\'now\')'),
    deleteQR: db.prepare('DELETE FROM qr_codes WHERE session_id = ?'),
    
    // Message queries
    saveMessage: db.prepare(`
        INSERT INTO messages (session_id, message_id, to_number, content, media_type, file_name, caption, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getMessages: db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?'),
    getAllMessages: db.prepare('SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?')
};

// Initialize WhatsApp client for a session
async function initializeWhatsAppClient(sessionData) {
    const { id, name, description } = sessionData;
    
    if (activeClients.has(id)) {
        console.log(`⚠️  Client for ${id} already exists`);
        return activeClients.get(id);
    }
    
    console.log(`🔄 Initializing WhatsApp client: ${name} (${id})`);
    
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: id
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    });

    // Store client
    activeClients.set(id, client);

    // QR Code event
    client.on('qr', (qr) => {
        console.log(`\n📱 QR CODE FOR ${name.toUpperCase()} (${id})`);
        console.log('='.repeat(50));
        
        // Display QR in terminal
        qrTerminal.generate(qr, { small: true }, function (qrString) {
            console.log(qrString);
        });
        
        console.log(`📱 Scan this QR code for: ${name}`);
        console.log('='.repeat(50) + '\n');
        
        // Store QR in database and memory
        qrcode.toDataURL(qr, (err, url) => {
            if (!err) {
                sessionQRs.set(id, url);
                dbQueries.saveQR.run(id, url);
                
                // Update session status
                dbQueries.updateSessionStatus.run('waiting_qr', 0, 0, null, null, id);
            }
        });
    });

    // Authentication events
    client.on('authenticated', () => {
        console.log(`✅ ${name} (${id}) authenticated successfully!`);
        
        // Update database
        dbQueries.updateSessionStatus.run('authenticated', 1, 0, null, null, id);
        
        // Clear QR code
        sessionQRs.delete(id);
        dbQueries.deleteQR.run(id);
    });

    client.on('auth_failure', (msg) => {
        console.error(`❌ ${name} (${id}) authentication failed: ${msg}`);
        dbQueries.updateSessionStatus.run('auth_failed', 0, 0, null, null, id);
    });

    client.on('ready', () => {
        console.log(`🚀 ${name} (${id}) is ready to send messages!`);
        
        // Get phone number and update database
        try {
            const info = client.info;
            const phone = info.wid.user;
            const connectedAt = new Date().toISOString();
            
            dbQueries.updateSessionStatus.run('ready', 1, 1, phone, connectedAt, id);
            
            console.log(`📞 ${name} connected with phone: +${phone}`);
        } catch (error) {
            console.warn(`Could not get phone number for ${id}`);
            dbQueries.updateSessionStatus.run('ready', 1, 1, null, new Date().toISOString(), id);
        }
    });

    client.on('disconnected', (reason) => {
        console.log(`⚠️ ${name} (${id}) disconnected: ${reason}`);
        dbQueries.updateSessionStatus.run('disconnected', 0, 0, null, null, id);
    });

    // Initialize client
    try {
        await client.initialize();
        dbQueries.updateSessionStatus.run('initializing', 0, 0, null, null, id);
    } catch (error) {
        console.error(`Failed to initialize ${id}:`, error);
        dbQueries.updateSessionStatus.run('failed', 0, 0, null, null, id);
    }
    
    return client;
}

// Load existing sessions from database and initialize them
function loadExistingSessions() {
    const sessions = dbQueries.getAllSessions.all();
    console.log(`📱 Found ${sessions.length} sessions in database`);
    
    for (const session of sessions) {
        if (session.status !== 'removed') {
            initializeWhatsAppClient(session);
        }
    }
}

// Utility functions
function getReadySessions() {
    const sessions = dbQueries.getAllSessions.all();
    return sessions.filter(s => s.ready === 1 && s.status === 'ready');
}

let lastUsedSessionIndex = 0;
function selectSession(preferredSessionId = null) {
    const readySessions = getReadySessions();
    
    if (readySessions.length === 0) {
        throw new Error('No WhatsApp sessions are ready. Please authenticate at least one session.');
    }
    
    // Use preferred session if specified and available
    if (preferredSessionId) {
        const session = readySessions.find(s => s.id === preferredSessionId);
        if (session) {
            return { sessionId: preferredSessionId, session };
        }
    }
    
    // Round-robin selection
    const session = readySessions[lastUsedSessionIndex % readySessions.length];
    lastUsedSessionIndex = (lastUsedSessionIndex + 1) % readySessions.length;
    
    return { sessionId: session.id, session };
}

function extractMessageId(sentMessage, fallbackPrefix = 'msg') {
    const debugMode = process.env.DEBUG_MESSAGE_STRUCTURE === 'true';
    
    if (debugMode) {
        console.log('Message object received:', sentMessage);
    }
    
    if (!sentMessage || sentMessage === undefined) {
        return `${fallbackPrefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    if (sentMessage.id && sentMessage.id._serialized) {
        return sentMessage.id._serialized;
    } else if (sentMessage.id && typeof sentMessage.id === 'string') {
        return sentMessage.id;
    } else if (sentMessage._serialized) {
        return sentMessage._serialized;
    } else if (sentMessage.key && sentMessage.key.id) {
        return sentMessage.key.id;
    } else {
        return `${fallbackPrefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// File upload configuration
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + extension);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain', 'text/csv',
        'audio/mpeg', 'audio/wav', 'audio/ogg',
        'video/mp4', 'video/avi', 'video/mov', 'video/wmv'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${file.mimetype} not supported`), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 16 * 1024 * 1024
    }
});

// API Routes

// Health check
app.get('/', (req, res) => {
    const sessions = dbQueries.getAllSessions.all();
    const readySessions = sessions.filter(s => s.ready === 1).length;
    
    res.json({
        message: 'SQLite-Based Multi-Session WhatsApp API Server',
        status: 'online',
        totalSessions: sessions.length,
        readySessions: readySessions,
        database: 'SQLite',
        dbPath: dbPath
    });
});

// =============================================================================
// AUTHENTICATION ROUTES
// =============================================================================

// Login page route
app.get('/login', (req, res) => {
    if (req.session && req.session.authenticated) {
        return res.redirect('/');
    }
    
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Login - WhatsApp API</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .login-container {
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(10px);
                    border-radius: 20px;
                    padding: 40px;
                    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.2);
                    width: 100%;
                    max-width: 400px;
                    text-align: center;
                }
                
                .login-header {
                    margin-bottom: 30px;
                }
                
                .login-header h1 {
                    color: #667eea;
                    font-size: 2.5em;
                    margin-bottom: 10px;
                }
                
                .login-header p {
                    color: #666;
                    font-size: 1.1em;
                }
                
                .form-group {
                    margin-bottom: 20px;
                    text-align: left;
                }
                
                .form-group label {
                    display: block;
                    margin-bottom: 8px;
                    font-weight: 600;
                    color: #333;
                }
                
                .form-group input {
                    width: 100%;
                    padding: 15px;
                    border: 2px solid #e0e0e0;
                    border-radius: 10px;
                    font-size: 16px;
                    transition: border-color 0.3s ease;
                }
                
                .form-group input:focus {
                    outline: none;
                    border-color: #667eea;
                }
                
                .login-btn {
                    width: 100%;
                    padding: 15px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    border-radius: 10px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                }
                
                .login-btn:hover {
                    opacity: 0.9;
                    transform: translateY(-2px);
                }
                
                .error-message {
                    background: #f8d7da;
                    border: 1px solid #f5c6cb;
                    color: #721c24;
                    padding: 12px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                    font-size: 14px;
                }
                
                .footer {
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid #e0e0e0;
                    color: #666;
                    font-size: 14px;
                }
            </style>
        </head>
        <body>
            <div class="login-container">
                <div class="login-header">
                    <h1>🔐 Login</h1>
                    <p>WhatsApp API Dashboard</p>
                </div>
                
                <div id="errorMessage" class="error-message" style="display: none;"></div>
                
                <form id="loginForm">
                    <div class="form-group">
                        <label for="username">Username:</label>
                        <input type="text" id="username" name="username" required autocomplete="username">
                    </div>
                    
                    <div class="form-group">
                        <label for="password">Password:</label>
                        <input type="password" id="password" name="password" required autocomplete="current-password">
                    </div>
                    
                    <button type="submit" class="login-btn">Login</button>
                </form>
                
                <div class="footer">
                    <p>Secure access to WhatsApp API management</p>
                </div>
            </div>
            
            <script>
                document.getElementById('loginForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    
                    const username = document.getElementById('username').value;
                    const password = document.getElementById('password').value;
                    const errorDiv = document.getElementById('errorMessage');
                    const submitBtn = e.target.querySelector('button[type="submit"]');
                    
                    // Reset error message
                    errorDiv.style.display = 'none';
                    
                    // Disable submit button
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Logging in...';
                    
                    try {
                        const response = await fetch('/api/auth/login', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ username, password })
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            window.location.href = '/';
                        } else {
                            errorDiv.textContent = data.error || 'Login failed';
                            errorDiv.style.display = 'block';
                        }
                    } catch (error) {
                        errorDiv.textContent = 'Network error. Please try again.';
                        errorDiv.style.display = 'block';
                    } finally {
                        // Re-enable submit button
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Login';
                    }
                });
                
                // Focus on username field
                document.getElementById('username').focus();
            </script>
        </body>
        </html>
    `);
});

// Login API endpoint
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({
            success: false,
            error: 'Username and password are required'
        });
    }
    
    if (username === AUTH_CONFIG.username && password === AUTH_CONFIG.password) {
        req.session.authenticated = true;
        req.session.username = username;
        req.session.loginTime = new Date().toISOString();
        
        res.json({
            success: true,
            message: 'Login successful',
            user: username
        });
    } else {
        res.status(401).json({
            success: false,
            error: 'Invalid username or password'
        });
    }
});

// Logout API endpoint
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: 'Could not log out'
            });
        }
        
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    });
});

// Check authentication status
app.get('/api/auth/status', (req, res) => {
    res.json({
        success: true,
        authenticated: !!(req.session && req.session.authenticated),
        user: req.session?.username || null,
        loginTime: req.session?.loginTime || null
    });
});

// =============================================================================
// WHATSAPP API ROUTES
// =============================================================================

// Get all sessions
app.get('/api/sessions', (req, res) => {
    try {
        const sessions = dbQueries.getAllSessions.all();
        const readySessions = sessions.filter(s => s.ready === 1).map(s => s.id);
        
        res.json({
            success: true,
            sessions: sessions,
            readySessions: readySessions,
            totalSessions: sessions.length,
            activeSessions: readySessions.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to fetch sessions: ' + error.message
        });
    }
});

// Create new session
app.post('/api/sessions', async (req, res) => {
    try {
        const { sessionId, sessionName, description } = req.body;
        
        if (!sessionId || !sessionName) {
            return res.status(400).json({
                success: false,
                error: 'sessionId and sessionName are required'
            });
        }
        
        // Check if session already exists
        const existingSession = dbQueries.getSession.get(sessionId);
        if (existingSession) {
            return res.status(400).json({
                success: false,
                error: 'Session with this ID already exists'
            });
        }
        
        // Create session in database
        dbQueries.createSession.run(sessionId, sessionName, description || `Session ${sessionId}`);
        
        // Initialize WhatsApp client
        const sessionData = { id: sessionId, name: sessionName, description };
        await initializeWhatsAppClient(sessionData);
        
        // Get created session
        const newSession = dbQueries.getSession.get(sessionId);
        
        res.json({
            success: true,
            message: 'Session created and initialized successfully',
            session: newSession
        });
        
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create session: ' + error.message
        });
    }
});

// Get specific session
app.get('/api/sessions/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = dbQueries.getSession.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }
        
        // Check if client is active
        const hasActiveClient = activeClients.has(sessionId);
        
        res.json({
            success: true,
            session: {
                ...session,
                hasActiveClient,
                hasQR: sessionQRs.has(sessionId)
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to fetch session: ' + error.message
        });
    }
});

// Get QR code for session
app.get('/api/sessions/:sessionId/qr', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = dbQueries.getSession.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }
        
        if (session.authenticated) {
            return res.json({
                success: false,
                message: 'Session is already authenticated'
            });
        }
        
        // Check memory first, then database
        let qrCode = sessionQRs.get(sessionId);
        if (!qrCode) {
            const qrData = dbQueries.getQR.get(sessionId);
            if (qrData) {
                qrCode = qrData.qr_data;
                sessionQRs.set(sessionId, qrCode); // Cache in memory
            }
        }
        
        if (!qrCode) {
            return res.json({
                success: false,
                message: 'QR code not available yet. Please wait or initialize the session...'
            });
        }
        
        res.json({
            success: true,
            qrCode: qrCode,
            sessionInfo: session
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get QR code: ' + error.message
        });
    }
});

// Initialize/Restart session (if not active)
app.post('/api/sessions/:sessionId/initialize', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = dbQueries.getSession.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }
        
        if (activeClients.has(sessionId)) {
            return res.json({
                success: false,
                message: 'Session is already active'
            });
        }
        
        // Initialize WhatsApp client
        await initializeWhatsAppClient(session);
        
        res.json({
            success: true,
            message: 'Session initialization started. Check QR code endpoint for authentication.'
        });
        
    } catch (error) {
        console.error('Error initializing session:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to initialize session: ' + error.message
        });
    }
});

// Logout session
app.post('/api/sessions/:sessionId/logout', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const client = activeClients.get(sessionId);
        
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Session not found or not active'
            });
        }
        
        await client.logout();
        
        // Update database
        dbQueries.updateSessionStatus.run('logged_out', 0, 0, null, null, sessionId);
        
        // Clean up
        sessionQRs.delete(sessionId);
        dbQueries.deleteQR.run(sessionId);
        
        res.json({
            success: true,
            message: 'Session logged out successfully'
        });
        
    } catch (error) {
        console.error('Error logging out session:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to logout session: ' + error.message
        });
    }
});

// Delete session
app.delete('/api/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const client = activeClients.get(sessionId);
        
        // Logout and destroy client if active
        if (client) {
            try {
                await client.logout();
                await client.destroy();
            } catch (error) {
                console.warn(`Warning during session ${sessionId} cleanup:`, error.message);
            }
            activeClients.delete(sessionId);
        }
        
        // Delete from database
        dbQueries.deleteSession.run(sessionId);
        dbQueries.deleteQR.run(sessionId);
        
        // Clean up memory
        sessionQRs.delete(sessionId);
        
        res.json({
            success: true,
            message: 'Session deleted successfully'
        });
        
    } catch (error) {
        console.error('Error deleting session:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete session: ' + error.message
        });
    }
});

// Bulk create sessions
app.post('/api/sessions/bulk', async (req, res) => {
    try {
        const { sessions } = req.body;
        
        if (!Array.isArray(sessions) || sessions.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'sessions array is required and must not be empty'
            });
        }
        
        const results = [];
        
        for (const sessionData of sessions) {
            const { sessionId, sessionName, description } = sessionData;
            
            if (!sessionId || !sessionName) {
                results.push({
                    sessionId,
                    success: false,
                    error: 'sessionId and sessionName are required'
                });
                continue;
            }
            
            try {
                const existingSession = dbQueries.getSession.get(sessionId);
                if (existingSession) {
                    results.push({
                        sessionId,
                        success: false,
                        error: 'Session already exists'
                    });
                    continue;
                }
                
                // Create in database
                dbQueries.createSession.run(sessionId, sessionName, description || `Bulk session ${sessionId}`);
                
                // Initialize client
                await initializeWhatsAppClient({ id: sessionId, name: sessionName, description });
                
                results.push({
                    sessionId,
                    success: true,
                    message: 'Session created and initialized successfully'
                });
                
            } catch (error) {
                results.push({
                    sessionId,
                    success: false,
                    error: error.message
                });
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        
        res.json({
            success: true,
            message: `Bulk operation completed: ${successCount}/${sessions.length} sessions created`,
            results: results
        });
        
    } catch (error) {
        console.error('Error in bulk create:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to bulk create sessions: ' + error.message
        });
    }
});

// Send message
app.post('/api/send', async (req, res) => {
    try {
        const { to, message, sessionId } = req.body;

        if (!to || !message) {
            return res.status(400).json({
                success: false,
                error: 'to and message are required'
            });
        }

        // Select session
        const { sessionId: selectedSessionId, session } = selectSession(sessionId);
        const client = activeClients.get(selectedSessionId);

        if (!client) {
            return res.status(503).json({
                success: false,
                error: 'Selected session is not active'
            });
        }

        // Format phone number
        let formattedNumber = to.replace(/\D/g, '');
        if (!formattedNumber.startsWith('91') && formattedNumber.length === 10) {
            formattedNumber = '91' + formattedNumber;
        }

        const chatId = formattedNumber + '@c.us';

        // Check if number exists on WhatsApp
        const numberExists = await client.isRegisteredUser(chatId);
        if (!numberExists) {
            return res.status(400).json({
                success: false,
                error: 'This number is not registered on WhatsApp'
            });
        }

        // Generate message ID
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substr(2, 9);
        const messageId = `msg_${timestamp}_${uniqueId}`;

        // Send message
        const sentMessage = await client.sendMessage(chatId, message);
        const realMessageId = extractMessageId(sentMessage, 'msg');

        // Save to database
        dbQueries.saveMessage.run(
            selectedSessionId,
            realMessageId,
            formattedNumber,
            message,
            'text',
            null,
            null,
            'sent'
        );

        res.json({
            success: true,
            message: 'Message sent successfully',
            messageId: realMessageId,
            to: formattedNumber,
            content: message,
            sessionId: selectedSessionId,
            sessionName: session.name,
            fromPhone: session.phone,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send message: ' + error.message
        });
    }
});

// Send media
app.post('/api/send-media', upload.single('media'), async (req, res) => {
    try {
        const { to, caption, sessionId } = req.body;
        const file = req.file;

        if (!to || !file) {
            return res.status(400).json({
                success: false,
                error: 'to and media file are required'
            });
        }

        // Select session
        const { sessionId: selectedSessionId, session } = selectSession(sessionId);
        const client = activeClients.get(selectedSessionId);

        if (!client) {
            if (file) fs.unlinkSync(file.path);
            return res.status(503).json({
                success: false,
                error: 'Selected session is not active'
            });
        }

        // Format phone number
        let formattedNumber = to.replace(/\D/g, '');
        if (!formattedNumber.startsWith('91') && formattedNumber.length === 10) {
            formattedNumber = '91' + formattedNumber;
        }

        const chatId = formattedNumber + '@c.us';

        // Check if number exists
        const numberExists = await client.isRegisteredUser(chatId);
        if (!numberExists) {
            fs.unlinkSync(file.path);
            return res.status(400).json({
                success: false,
                error: 'This number is not registered on WhatsApp'
            });
        }

        // Create media
        const media = MessageMedia.fromFilePath(file.path);
        if (file.mimetype.includes('application/') || file.mimetype.includes('text/')) {
            media.filename = file.originalname;
        }

        // Generate message ID
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substr(2, 9);
        const messageId = `media_${timestamp}_${uniqueId}`;

        // Send media
        const sentMessage = await client.sendMessage(chatId, media, { 
            caption: caption || undefined 
        });

        const realMessageId = extractMessageId(sentMessage, 'media');

        // Save to database
        dbQueries.saveMessage.run(
            selectedSessionId,
            realMessageId,
            formattedNumber,
            caption || '',
            file.mimetype,
            file.originalname,
            caption,
            'sent'
        );

        // Clean up file
        setTimeout(() => {
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        }, 1000);

        res.json({
            success: true,
            message: 'Media sent successfully',
            messageId: realMessageId,
            to: formattedNumber,
            mediaType: file.mimetype,
            fileName: file.originalname,
            caption: caption || null,
            sessionId: selectedSessionId,
            sessionName: session.name,
            fromPhone: session.phone,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error sending media:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            success: false,
            error: 'Failed to send media: ' + error.message
        });
    }
});

// Get messages for a session
app.get('/api/sessions/:sessionId/messages', (req, res) => {
    try {
        const { sessionId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        
        const messages = dbQueries.getMessages.all(sessionId, limit);
        
        res.json({
            success: true,
            messages: messages,
            sessionId: sessionId,
            count: messages.length
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to fetch messages: ' + error.message
        });
    }
});

// Get all messages
app.get('/api/messages', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const messages = dbQueries.getAllMessages.all(limit);
        
        res.json({
            success: true,
            messages: messages,
            count: messages.length
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to fetch messages: ' + error.message
        });
    }
});

// Get database stats
app.get('/api/stats', (req, res) => {
    try {
        const sessions = dbQueries.getAllSessions.all();
        const readySessions = sessions.filter(s => s.ready === 1);
        const authenticatedSessions = sessions.filter(s => s.authenticated === 1);
        
        const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get();
        const qrCount = db.prepare('SELECT COUNT(*) as count FROM qr_codes WHERE expires_at > datetime(\'now\')').get();
        
        res.json({
            success: true,
            stats: {
                totalSessions: sessions.length,
                readySessions: readySessions.length,
                authenticatedSessions: authenticatedSessions.length,
                activeClients: activeClients.size,
                totalMessages: messageCount.count,
                activeQRCodes: qrCount.count,
                databaseSize: fs.statSync(dbPath).size,
                uptime: process.uptime()
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to fetch stats: ' + error.message
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: 'Something went wrong!'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    
    // Close all WhatsApp clients
    for (const [id, client] of activeClients) {
        try {
            await client.destroy();
            console.log(`✅ Session ${id} destroyed`);
        } catch (error) {
            console.error(`❌ Error destroying session ${id}:`, error);
        }
    }
    
    // Close database
    db.close();
    console.log('✅ Database closed');
    
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    
    for (const [id, client] of activeClients) {
        try {
            await client.destroy();
        } catch (error) {
            console.error(`Error destroying session ${id}:`, error);
        }
    }
    
    db.close();
    process.exit(0);
});

// Load existing sessions and start server
loadExistingSessions();

app.listen(PORT, () => {
    console.log('\n' + '🌟'.repeat(35));
    console.log('📱 SQLITE-BASED MULTI-SESSION WHATSAPP API 📱');
    console.log('🌟'.repeat(35));
    console.log(`🚀 Server running on: http://localhost:${PORT}`);
    console.log(`🌐 Web Dashboard: http://localhost:${PORT}`);
    console.log(`📡 API Base URL: http://localhost:${PORT}/api`);
    console.log(`📊 Database: ${dbPath}`);
    console.log(`📱 Active Sessions: ${activeClients.size}`);
    console.log('🌟'.repeat(35));
    console.log('\n✨ SQLite-based session management enabled');
    console.log('🔄 Use API endpoints to add/manage sessions dynamically\n');
});
