// Multi-Session WhatsApp API Server
// Suppress punycode deprecation warning (from whatsapp-web.js dependencies)
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
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Multi-session storage
const sessions = new Map();
const sessionQRs = new Map();
const sessionStatus = new Map();

// Session configuration - Add unlimited phone numbers here
let SESSION_CONFIG = [
    { id: 'session1', name: 'Primary WhatsApp', description: 'Main business account' },
    { id: 'session2', name: 'Secondary WhatsApp', description: 'Support account' },
    { id: 'session3', name: 'Marketing WhatsApp', description: 'Marketing campaigns' },
    { id: 'session4', name: 'Sales WhatsApp', description: 'Sales team account' },
    { id: 'session5', name: 'Customer Service', description: 'Customer service team' },
    { id: 'session6', name: 'Technical Support', description: 'Technical support team' },
    { id: 'session7', name: 'Regional Office 1', description: 'Regional office account' },
    { id: 'session8', name: 'Regional Office 2', description: 'Another regional office' },
    { id: 'session9', name: 'Backup Account 1', description: 'Emergency backup account' },
    { id: 'session10', name: 'Backup Account 2', description: 'Secondary backup account' }
    // Add as many sessions as you need - there's no limit!
    // Each session = one WhatsApp phone number
    // Example:
    // { id: 'session11', name: 'International Sales', description: 'International market' },
    // { id: 'session12', name: 'VIP Customers', description: 'VIP customer support' },
    // { id: 'session13', name: 'Automated Alerts', description: 'System notifications' }
];

// Support for environment-based session configuration
// You can also define sessions via environment variables
// Format: WHATSAPP_SESSIONS=session1:Primary WhatsApp:Main account,session2:Support:Support team
if (process.env.WHATSAPP_SESSIONS) {
    try {
        const envSessions = process.env.WHATSAPP_SESSIONS.split(',').map(sessionStr => {
            const [id, name, description] = sessionStr.split(':');
            return { id, name, description };
        });
        if (envSessions.length > 0) {
            SESSION_CONFIG = envSessions;
            console.log(`📱 Using ${envSessions.length} sessions from environment variables`);
        }
    } catch (error) {
        console.warn('⚠️  Error parsing WHATSAPP_SESSIONS environment variable, using default config');
    }
}

// Support for generating sessions from count
// Set WHATSAPP_SESSION_COUNT=20 to auto-generate 20 sessions
if (process.env.WHATSAPP_SESSION_COUNT) {
    const count = parseInt(process.env.WHATSAPP_SESSION_COUNT);
    if (count > 0) {
        SESSION_CONFIG = [];
        for (let i = 1; i <= count; i++) {
            SESSION_CONFIG.push({
                id: `session${i}`,
                name: `WhatsApp Account ${i}`,
                description: `Auto-generated session ${i}`
            });
        }
        console.log(`📱 Auto-generated ${count} sessions from WHATSAPP_SESSION_COUNT`);
    }
}

// Initialize WhatsApp sessions
function initializeSession(sessionConfig) {
    const { id, name, description } = sessionConfig;
    
    console.log(`🔄 Initializing session: ${name} (${id})`);
    
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
    sessions.set(id, client);
    sessionStatus.set(id, {
        id,
        name,
        description,
        authenticated: false,
        ready: false,
        phone: null,
        connectedAt: null,
        hasQR: false
    });

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
        
        // Store QR for web interface
        qrcode.toDataURL(qr, (err, url) => {
            if (!err) {
                sessionQRs.set(id, url);
                const status = sessionStatus.get(id);
                status.hasQR = true;
                sessionStatus.set(id, status);
            }
        });
    });

    // Authentication events
    client.on('authenticated', () => {
        console.log(`✅ ${name} (${id}) authenticated successfully!`);
        const status = sessionStatus.get(id);
        status.authenticated = true;
        status.hasQR = false;
        sessionStatus.set(id, status);
        sessionQRs.delete(id); // Remove QR after authentication
    });

    client.on('auth_failure', (msg) => {
        console.error(`❌ ${name} (${id}) authentication failed: ${msg}`);
        const status = sessionStatus.get(id);
        status.authenticated = false;
        status.ready = false;
        sessionStatus.set(id, status);
    });

    client.on('ready', () => {
        console.log(`🚀 ${name} (${id}) is ready to send messages!`);
        const status = sessionStatus.get(id);
        status.ready = true;
        status.connectedAt = new Date().toISOString();
        
        // Get phone number
        try {
            const info = client.info;
            status.phone = info.wid.user;
        } catch (error) {
            console.warn(`Could not get phone number for ${id}`);
        }
        
        sessionStatus.set(id, status);
    });

    client.on('disconnected', (reason) => {
        console.log(`⚠️ ${name} (${id}) disconnected: ${reason}`);
        const status = sessionStatus.get(id);
        status.authenticated = false;
        status.ready = false;
        status.connectedAt = null;
        sessionStatus.set(id, status);
    });

    // Initialize client
    client.initialize();
}

// Initialize all sessions
SESSION_CONFIG.forEach(config => {
    initializeSession(config);
});

// Utility function to get available sessions
function getAvailableSessions() {
    const available = [];
    for (const [id, status] of sessionStatus.entries()) {
        if (status.ready) {
            available.push(id);
        }
    }
    return available;
}

// Utility function to select session (round-robin if not specified)
let lastUsedSessionIndex = 0;
function selectSession(preferredSessionId = null) {
    const availableSessions = getAvailableSessions();
    
    if (availableSessions.length === 0) {
        throw new Error('No WhatsApp sessions are ready. Please authenticate at least one session.');
    }
    
    // Use preferred session if specified and available
    if (preferredSessionId && availableSessions.includes(preferredSessionId)) {
        return preferredSessionId;
    }
    
    // Round-robin selection
    const sessionId = availableSessions[lastUsedSessionIndex % availableSessions.length];
    lastUsedSessionIndex = (lastUsedSessionIndex + 1) % availableSessions.length;
    
    return sessionId;
}

// Utility function to safely extract message ID
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

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
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

// Routes

// Health check with all sessions
app.get('/', (req, res) => {
    const sessionsInfo = Array.from(sessionStatus.values());
    const readySessions = sessionsInfo.filter(s => s.ready).length;
    
    res.json({
        message: 'Multi-Session WhatsApp API Server is running',
        status: 'online',
        totalSessions: sessionsInfo.length,
        readySessions: readySessions,
        sessions: sessionsInfo
    });
});

// Get all sessions status
app.get('/api/sessions', (req, res) => {
    const sessionsInfo = Array.from(sessionStatus.values());
    res.json({
        success: true,
        sessions: sessionsInfo,
        availableSessions: getAvailableSessions()
    });
});

// Get specific session status
app.get('/api/sessions/:sessionId/status', (req, res) => {
    const { sessionId } = req.params;
    const status = sessionStatus.get(sessionId);
    
    if (!status) {
        return res.status(404).json({
            success: false,
            error: 'Session not found'
        });
    }
    
    res.json({
        success: true,
        session: status,
        hasQR: sessionQRs.has(sessionId)
    });
});

// Get QR code for specific session
app.get('/api/sessions/:sessionId/qr', (req, res) => {
    const { sessionId } = req.params;
    const status = sessionStatus.get(sessionId);
    
    if (!status) {
        return res.status(404).json({
            success: false,
            error: 'Session not found'
        });
    }
    
    if (status.authenticated) {
        return res.json({
            success: false,
            message: 'Session is already authenticated'
        });
    }
    
    const qrCode = sessionQRs.get(sessionId);
    if (!qrCode) {
        return res.json({
            success: false,
            message: 'QR code not available yet. Please wait...'
        });
    }
    
    res.json({
        success: true,
        qrCode: qrCode,
        sessionInfo: status
    });
});

// Add new session dynamically (without restart)
app.post('/api/sessions/add', async (req, res) => {
    try {
        const { sessionId, sessionName, description } = req.body;
        
        if (!sessionId || !sessionName) {
            return res.status(400).json({
                success: false,
                error: 'sessionId and sessionName are required'
            });
        }
        
        // Check if session already exists
        if (sessions.has(sessionId)) {
            return res.status(400).json({
                success: false,
                error: 'Session with this ID already exists'
            });
        }
        
        // Create new session config
        const newSessionConfig = {
            id: sessionId,
            name: sessionName,
            description: description || `Dynamic session ${sessionId}`
        };
        
        // Initialize the new session
        console.log(`🔄 Adding new session dynamically: ${sessionName} (${sessionId})`);
        await initializeSession(newSessionConfig);
        
        res.json({
            success: true,
            message: 'Session added successfully',
            session: sessionStatus.get(sessionId)
        });
        
    } catch (error) {
        console.error('Error adding session:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add session: ' + error.message
        });
    }
});

// Remove session dynamically
app.delete('/api/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!sessions.has(sessionId)) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }
        
        // Logout and destroy the session
        const client = sessions.get(sessionId);
        if (client) {
            try {
                await client.logout();
                await client.destroy();
            } catch (error) {
                console.warn(`Warning during session ${sessionId} cleanup:`, error.message);
            }
        }
        
        // Clean up storage
        sessions.delete(sessionId);
        sessionStatus.delete(sessionId);
        sessionQRs.delete(sessionId);
        
        console.log(`🗑️  Removed session: ${sessionId}`);
        
        res.json({
            success: true,
            message: 'Session removed successfully'
        });
        
    } catch (error) {
        console.error('Error removing session:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to remove session: ' + error.message
        });
    }
});

// Bulk add sessions
app.post('/api/sessions/bulk-add', async (req, res) => {
    try {
        const { sessions: sessionConfigs } = req.body;
        
        if (!Array.isArray(sessionConfigs) || sessionConfigs.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'sessions array is required and must not be empty'
            });
        }
        
        const results = [];
        
        for (const config of sessionConfigs) {
            const { sessionId, sessionName, description } = config;
            
            if (!sessionId || !sessionName) {
                results.push({
                    sessionId,
                    success: false,
                    error: 'sessionId and sessionName are required'
                });
                continue;
            }
            
            if (sessions.has(sessionId)) {
                results.push({
                    sessionId,
                    success: false,
                    error: 'Session already exists'
                });
                continue;
            }
            
            try {
                const newSessionConfig = {
                    id: sessionId,
                    name: sessionName,
                    description: description || `Bulk session ${sessionId}`
                };
                
                console.log(`🔄 Bulk adding session: ${sessionName} (${sessionId})`);
                await initializeSession(newSessionConfig);
                
                results.push({
                    sessionId,
                    success: true,
                    message: 'Session added successfully'
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
            message: `Bulk operation completed: ${successCount}/${sessionConfigs.length} sessions added`,
            results: results
        });
        
    } catch (error) {
        console.error('Error in bulk add:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to bulk add sessions: ' + error.message
        });
    }
});

// Auto-generate sessions by count
app.post('/api/sessions/auto-generate', async (req, res) => {
    try {
        const { count, prefix = 'auto', namePrefix = 'Auto Session' } = req.body;
        
        if (!count || count <= 0 || count > 100) {
            return res.status(400).json({
                success: false,
                error: 'count must be between 1 and 100'
            });
        }
        
        const newSessions = [];
        
        for (let i = 1; i <= count; i++) {
            const sessionId = `${prefix}${i}`;
            const sessionName = `${namePrefix} ${i}`;
            
            if (!sessions.has(sessionId)) {
                newSessions.push({
                    id: sessionId,
                    name: sessionName,
                    description: `Auto-generated session ${i}`
                });
            }
        }
        
        console.log(`🤖 Auto-generating ${newSessions.length} sessions...`);
        
        for (const config of newSessions) {
            await initializeSession(config);
        }
        
        res.json({
            success: true,
            message: `Auto-generated ${newSessions.length} sessions`,
            sessions: newSessions.map(s => s.id),
            totalSessions: sessions.size
        });
        
    } catch (error) {
        console.error('Error auto-generating sessions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to auto-generate sessions: ' + error.message
        });
    }
});

// Logout specific session
app.post('/api/sessions/:sessionId/logout', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const client = sessions.get(sessionId);
        
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }
        
        await client.logout();
        
        // Update status
        const status = sessionStatus.get(sessionId);
        if (status) {
            status.authenticated = false;
            status.ready = false;
            status.phone = null;
            status.connectedAt = null;
            sessionStatus.set(sessionId, status);
        }
        
        sessionQRs.delete(sessionId);
        
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

// Get session info
app.get('/api/sessions/:sessionId/info', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const client = sessions.get(sessionId);
        const status = sessionStatus.get(sessionId);
        
        if (!client || !status) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }
        
        if (!status.ready) {
            return res.json({
                success: false,
                message: 'Session is not ready',
                sessionActive: false,
                session: status
            });
        }
        
        const info = client.info;
        res.json({
            success: true,
            sessionActive: true,
            sessionInfo: {
                ...status,
                clientInfo: {
                    phone: info.wid.user,
                    name: info.pushname || 'Unknown',
                    platform: info.platform
                }
            }
        });
        
    } catch (error) {
        console.error('Error getting session info:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get session info: ' + error.message
        });
    }
});

// Send message with session selection
app.post('/api/send-message', async (req, res) => {
    try {
        const { number, message, sessionId } = req.body;

        // Validation
        if (!number || !message) {
            return res.status(400).json({
                success: false,
                error: 'Both number and message are required'
            });
        }

        // Select session
        let selectedSessionId;
        try {
            selectedSessionId = selectSession(sessionId);
        } catch (error) {
            return res.status(503).json({
                success: false,
                error: error.message
            });
        }

        const client = sessions.get(selectedSessionId);
        const sessionInfo = sessionStatus.get(selectedSessionId);

        // Format phone number
        let formattedNumber = number.replace(/\D/g, '');
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

        res.json({
            success: true,
            message: 'Message sent successfully',
            messageId: realMessageId !== `msg_${timestamp}_${uniqueId}` ? realMessageId : messageId,
            to: formattedNumber,
            content: message,
            sessionId: selectedSessionId,
            sessionName: sessionInfo.name,
            fromPhone: sessionInfo.phone,
            timestamp: new Date().toISOString(),
            deliveryStatus: 'sent'
        });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send message: ' + error.message
        });
    }
});

// Send media with session selection
app.post('/api/send-media', upload.single('media'), async (req, res) => {
    try {
        const { number, caption, sessionId } = req.body;
        const file = req.file;

        if (!number || !file) {
            return res.status(400).json({
                success: false,
                error: 'Phone number and media file are required'
            });
        }

        // Select session
        let selectedSessionId;
        try {
            selectedSessionId = selectSession(sessionId);
        } catch (error) {
            if (file) fs.unlinkSync(file.path);
            return res.status(503).json({
                success: false,
                error: error.message
            });
        }

        const client = sessions.get(selectedSessionId);
        const sessionInfo = sessionStatus.get(selectedSessionId);

        // Format phone number
        let formattedNumber = number.replace(/\D/g, '');
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

        // Clean up file
        setTimeout(() => {
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        }, 1000);

        res.json({
            success: true,
            message: 'Media sent successfully',
            messageId: realMessageId !== `media_${timestamp}_${uniqueId}` ? realMessageId : messageId,
            to: formattedNumber,
            mediaType: file.mimetype,
            fileName: file.originalname,
            caption: caption || null,
            sessionId: selectedSessionId,
            sessionName: sessionInfo.name,
            fromPhone: sessionInfo.phone,
            timestamp: new Date().toISOString(),
            deliveryStatus: 'sent'
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

// Add the remaining endpoints (media-url, media-types, etc.)
app.post('/api/send-media-url', async (req, res) => {
    try {
        const { number, mediaUrl, mediaType, caption, filename, sessionId } = req.body;

        if (!number || !mediaUrl || !mediaType) {
            return res.status(400).json({
                success: false,
                error: 'Number, mediaUrl, and mediaType are required'
            });
        }

        // Select session
        let selectedSessionId;
        try {
            selectedSessionId = selectSession(sessionId);
        } catch (error) {
            return res.status(503).json({
                success: false,
                error: error.message
            });
        }

        const client = sessions.get(selectedSessionId);
        const sessionInfo = sessionStatus.get(selectedSessionId);

        // Format phone number
        let formattedNumber = number.replace(/\D/g, '');
        if (!formattedNumber.startsWith('91') && formattedNumber.length === 10) {
            formattedNumber = '91' + formattedNumber;
        }

        const chatId = formattedNumber + '@c.us';

        // Check if number exists
        const numberExists = await client.isRegisteredUser(chatId);
        if (!numberExists) {
            return res.status(400).json({
                success: false,
                error: 'This number is not registered on WhatsApp'
            });
        }

        // Create media
        let media;
        if (mediaUrl.startsWith('data:')) {
            media = new MessageMedia(mediaType, mediaUrl.split(',')[1], filename);
        } else {
            media = await MessageMedia.fromUrl(mediaUrl);
            if (filename && (mediaType.includes('application/') || mediaType.includes('text/'))) {
                media.filename = filename;
            }
        }

        // Generate message ID
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substr(2, 9);
        const messageId = `media_url_${timestamp}_${uniqueId}`;

        // Send media
        const sentMessage = await client.sendMessage(chatId, media, { 
            caption: caption || undefined 
        });

        const realMessageId = extractMessageId(sentMessage, 'media_url');

        res.json({
            success: true,
            message: 'Media sent successfully',
            messageId: realMessageId !== `media_url_${timestamp}_${uniqueId}` ? realMessageId : messageId,
            to: formattedNumber,
            mediaType: mediaType,
            mediaSource: mediaUrl.startsWith('data:') ? 'base64' : 'url',
            caption: caption || null,
            sessionId: selectedSessionId,
            sessionName: sessionInfo.name,
            fromPhone: sessionInfo.phone,
            timestamp: new Date().toISOString(),
            deliveryStatus: 'sent'
        });

    } catch (error) {
        console.error('Error sending media from URL:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send media: ' + error.message
        });
    }
});

// Get supported media types
app.get('/api/media-types', (req, res) => {
    res.json({
        success: true,
        supportedTypes: {
            images: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
            documents: [
                'application/pdf', 'application/msword', 
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel', 
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.ms-powerpoint', 
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'text/plain', 'text/csv'
            ],
            audio: ['audio/mpeg', 'audio/wav', 'audio/ogg'],
            video: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv']
        },
        limits: {
            maxFileSize: '16MB',
            maxImageSize: '5MB (recommended)',
            note: 'WhatsApp has different limits for different media types'
        }
    });
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
    for (const [id, client] of sessions) {
        try {
            await client.destroy();
            console.log(`✅ Session ${id} destroyed`);
        } catch (error) {
            console.error(`❌ Error destroying session ${id}:`, error);
        }
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    for (const [id, client] of sessions) {
        try {
            await client.destroy();
        } catch (error) {
            console.error(`Error destroying session ${id}:`, error);
        }
    }
    process.exit(0);
});

app.listen(PORT, () => {
    console.log('\n' + '🌟'.repeat(30));
    console.log('📱 MULTI-SESSION WHATSAPP API SERVER STARTED 📱');
    console.log('🌟'.repeat(30));
    console.log(`🚀 Server running on: http://localhost:${PORT}`);
    console.log(`🌐 Web Dashboard: http://localhost:${PORT}`);
    console.log(`📡 API Base URL: http://localhost:${PORT}/api`);
    console.log(`📱 Total Sessions: ${SESSION_CONFIG.length}`);
    console.log('🌟'.repeat(30));
    console.log('\n⏳ Initializing WhatsApp sessions...');
    console.log('📱 QR Codes will appear below for each session\n');
});
