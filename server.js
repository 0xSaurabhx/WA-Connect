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

// WhatsApp client setup
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-bot"
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

// Store QR code and connection status
let qrCodeData = null;
let isAuthenticated = false;
let isReady = false;

// WhatsApp client events
client.on('qr', (qr) => {
    console.log('\n' + '='.repeat(50));
    console.log('📱 SCAN QR CODE WITH YOUR WHATSAPP APP');
    console.log('='.repeat(50));
    
    // Display compact QR code in terminal
    qrTerminal.generate(qr, { small: true }, function (qrString) {
        console.log(qrString);
    });
    
    console.log('='.repeat(50));
    console.log('📲 Open WhatsApp on your phone');
    console.log('📷 Go to Settings > Linked Devices > Link a Device');
    console.log('📱 Scan the QR code above');
    console.log('💻 Or visit http://localhost:' + PORT + ' for web interface');
    console.log('='.repeat(50) + '\n');
    
    // Also store for web interface (backup)
    qrcode.toDataURL(qr, (err, url) => {
        if (!err) {
            qrCodeData = url;
        }
    });
});

client.on('authenticated', () => {
    console.log('\n' + '✅'.repeat(20));
    console.log('🎉 WHATSAPP AUTHENTICATED SUCCESSFULLY! 🎉');
    console.log('✅'.repeat(20) + '\n');
    isAuthenticated = true;
    qrCodeData = null; // Clear QR code after authentication
});

client.on('auth_failure', (msg) => {
    console.error('\n' + '❌'.repeat(20));
    console.error('🚫 AUTHENTICATION FAILED: ' + msg);
    console.error('🔄 Please restart the server and try again');
    console.error('❌'.repeat(20) + '\n');
    isAuthenticated = false;
    isReady = false;
});

client.on('ready', () => {
    console.log('\n' + '🚀'.repeat(20));
    console.log('🌟 WHATSAPP CLIENT IS READY TO SEND MESSAGES! 🌟');
    console.log('📨 You can now use the API to send WhatsApp messages');
    console.log('🌐 Visit http://localhost:' + PORT + ' for the web dashboard');
    console.log('🚀'.repeat(20) + '\n');
    isReady = true;
});

client.on('disconnected', (reason) => {
    console.log('\n' + '⚠️ '.repeat(15));
    console.log('🔌 WhatsApp client disconnected: ' + reason);
    console.log('🔄 Attempting to reconnect...');
    console.log('⚠️ '.repeat(15) + '\n');
    isAuthenticated = false;
    isReady = false;
    qrCodeData = null;
});

// Initialize WhatsApp client
client.initialize();

// Note: whatsapp-web.js client.sendMessage() may return undefined in some versions
// This is normal behavior - the message is still sent successfully to WhatsApp
// We generate our own message IDs for tracking purposes

// Utility function to safely extract message ID
function extractMessageId(sentMessage, fallbackPrefix = 'msg') {
    // Enable debug logging via environment variable
    const debugMode = process.env.DEBUG_MESSAGE_STRUCTURE === 'true';
    
    if (debugMode) {
        console.log('Message object received:', sentMessage);
        console.log('Message object type:', typeof sentMessage);
    }
    
    if (!sentMessage || sentMessage === undefined) {
        if (debugMode) {
            console.log('ℹ️  WhatsApp client returned undefined - this is normal behavior in some versions');
        }
        return `${fallbackPrefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Try different possible structures
    if (sentMessage.id && sentMessage.id._serialized) {
        return sentMessage.id._serialized;
    } else if (sentMessage.id && typeof sentMessage.id === 'string') {
        return sentMessage.id;
    } else if (sentMessage._serialized) {
        return sentMessage._serialized;
    } else if (sentMessage.key && sentMessage.key.id) {
        return sentMessage.key.id;
    } else if (sentMessage.key) {
        return JSON.stringify(sentMessage.key);
    } else {
        if (debugMode) {
            console.warn('Could not extract message ID from structure:', Object.keys(sentMessage || {}));
        }
        return `${fallbackPrefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Create uploads directory if it doesn't exist
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
        // Generate unique filename with timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + extension);
    }
});

// File filter for allowed file types
const fileFilter = (req, file, cb) => {
    // Allowed file types for WhatsApp
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
        cb(new Error(`File type ${file.mimetype} not supported. Allowed types: Images, PDFs, Documents, Audio, Video`), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 16 * 1024 * 1024 // 16MB limit (WhatsApp's limit is 16MB for documents, 5MB for images)
    }
});

// Routes

// Health check
app.get('/', (req, res) => {
    res.json({
        message: 'WhatsApp API Server is running',
        status: 'online',
        authenticated: isAuthenticated,
        ready: isReady
    });
});

// Get connection status
app.get('/api/status', (req, res) => {
    res.json({
        authenticated: isAuthenticated,
        ready: isReady,
        hasQrCode: !!qrCodeData
    });
});

// Get QR code for authentication
app.get('/api/qr', (req, res) => {
    if (isAuthenticated) {
        return res.json({
            success: false,
            message: 'Already authenticated'
        });
    }

    if (!qrCodeData) {
        return res.json({
            success: false,
            message: 'QR code not available yet. Please wait...'
        });
    }

    res.json({
        success: true,
        qrCode: qrCodeData
    });
});

// Send message endpoint
app.post('/api/send-message', async (req, res) => {
    try {
        const { number, message } = req.body;

        // Validation
        if (!number || !message) {
            return res.status(400).json({
                success: false,
                error: 'Both number and message are required'
            });
        }

        if (!isReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp client is not ready. Please authenticate first.'
            });
        }

        // Format phone number (remove non-digits and add country code if needed)
        let formattedNumber = number.replace(/\D/g, '');
        
        // Add country code if not present (assuming default country code)
        if (!formattedNumber.startsWith('91') && formattedNumber.length === 10) {
            formattedNumber = '91' + formattedNumber; // Default to India (+91)
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

        // Generate a unique message ID before sending
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substr(2, 9);
        const messageId = `msg_${timestamp}_${uniqueId}`;

        // Send message
        try {
            const sentMessage = await client.sendMessage(chatId, message);
            
            // Try to extract real message ID if available
            const realMessageId = extractMessageId(sentMessage, 'msg');
            
            res.json({
                success: true,
                message: 'Message sent successfully',
                messageId: realMessageId !== `msg_${timestamp}_${uniqueId}` ? realMessageId : messageId,
                to: formattedNumber,
                content: message,
                timestamp: new Date().toISOString(),
                deliveryStatus: 'sent'
            });
        } catch (sendError) {
            throw sendError; // Re-throw to be caught by outer catch block
        }

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send message: ' + error.message
        });
    }
});

// Logout endpoint
app.post('/api/logout', async (req, res) => {
    try {
        await client.logout();
        isAuthenticated = false;
        isReady = false;
        qrCodeData = null;
        
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('Error during logout:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to logout: ' + error.message
        });
    }
});

// Get chat info
app.get('/api/chat-info/:number', async (req, res) => {
    try {
        if (!isReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp client is not ready'
            });
        }

        let formattedNumber = req.params.number.replace(/\D/g, '');
        if (!formattedNumber.startsWith('91') && formattedNumber.length === 10) {
            formattedNumber = '91' + formattedNumber;
        }

        const chatId = formattedNumber + '@c.us';
        const contact = await client.getContactById(chatId);

        res.json({
            success: true,
            contact: {
                id: contact.id._serialized,
                name: contact.name || contact.pushname || 'Unknown',
                number: contact.number,
                isBlocked: contact.isBlocked,
                isGroup: contact.isGroup,
                isMyContact: contact.isMyContact
            }
        });

    } catch (error) {
        console.error('Error getting chat info:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get chat info: ' + error.message
        });
    }
});

// Session info endpoint
app.get('/api/session-info', async (req, res) => {
    try {
        if (!isReady) {
            return res.json({
                success: false,
                message: 'WhatsApp client is not ready',
                sessionActive: false
            });
        }

        const info = client.info;
        res.json({
            success: true,
            sessionActive: true,
            sessionInfo: {
                clientId: 'whatsapp-bot',
                phone: info.wid.user,
                name: info.pushname || 'Unknown',
                platform: info.platform,
                sessionPersistent: true,
                authStrategy: 'LocalAuth',
                sessionLocation: '.wwebjs_auth/',
                connectedAt: new Date().toISOString()
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

// Clear session endpoint (forces re-authentication)
app.post('/api/clear-session', async (req, res) => {
    try {
        console.log('🗑️  Clearing WhatsApp session...');
        
        // Logout and destroy client
        if (client) {
            await client.logout();
            await client.destroy();
        }
        
        // Reset status
        isAuthenticated = false;
        isReady = false;
        qrCodeData = null;
        
        console.log('✅ Session cleared. Restart the server to authenticate again.');
        
        res.json({
            success: true,
            message: 'Session cleared successfully. Restart the server to authenticate again.'
        });
        
        // Exit process to force restart
        setTimeout(() => {
            process.exit(0);
        }, 1000);
        
    } catch (error) {
        console.error('Error clearing session:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear session: ' + error.message
        });
    }
});

// Send media message endpoint
app.post('/api/send-media', upload.single('media'), async (req, res) => {
    try {
        const { number, caption } = req.body;
        const file = req.file;

        // Validation
        if (!number) {
            return res.status(400).json({
                success: false,
                error: 'Phone number is required'
            });
        }

        if (!file) {
            return res.status(400).json({
                success: false,
                error: 'Media file is required'
            });
        }

        if (!isReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp client is not ready. Please authenticate first.'
            });
        }

        // Format phone number
        let formattedNumber = number.replace(/\D/g, '');
        if (!formattedNumber.startsWith('91') && formattedNumber.length === 10) {
            formattedNumber = '91' + formattedNumber;
        }

        const chatId = formattedNumber + '@c.us';

        // Check if number exists on WhatsApp
        const numberExists = await client.isRegisteredUser(chatId);
        if (!numberExists) {
            // Clean up uploaded file
            fs.unlinkSync(file.path);
            return res.status(400).json({
                success: false,
                error: 'This number is not registered on WhatsApp'
            });
        }

        // Create media from uploaded file
        const media = MessageMedia.fromFilePath(file.path);
        
        // Set filename for documents
        if (file.mimetype.includes('application/') || file.mimetype.includes('text/')) {
            media.filename = file.originalname;
        }

        // Generate a unique message ID before sending
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substr(2, 9);
        const messageId = `media_${timestamp}_${uniqueId}`;

        // Send media message
        try {
            const sentMessage = await client.sendMessage(chatId, media, { 
                caption: caption || undefined 
            });

            // Try to extract real message ID if available
            const realMessageId = extractMessageId(sentMessage, 'media');

            // Clean up uploaded file after sending
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
                timestamp: new Date().toISOString(),
                deliveryStatus: 'sent'
            });
        } catch (sendError) {
            throw sendError; // Re-throw to be caught by outer catch block
        }

    } catch (error) {
        console.error('Error sending media:', error);
        
        // Clean up uploaded file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({
            success: false,
            error: 'Failed to send media: ' + error.message
        });
    }
});

// Send media with URL endpoint (for URLs/base64)
app.post('/api/send-media-url', async (req, res) => {
    try {
        const { number, mediaUrl, mediaType, caption, filename } = req.body;

        // Validation
        if (!number || !mediaUrl || !mediaType) {
            return res.status(400).json({
                success: false,
                error: 'Number, mediaUrl, and mediaType are required'
            });
        }

        if (!isReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp client is not ready. Please authenticate first.'
            });
        }

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

        // Create media from URL or base64
        let media;
        if (mediaUrl.startsWith('data:')) {
            // Base64 data
            media = new MessageMedia(mediaType, mediaUrl.split(',')[1], filename);
        } else {
            // URL
            media = await MessageMedia.fromUrl(mediaUrl);
            if (filename && (mediaType.includes('application/') || mediaType.includes('text/'))) {
                media.filename = filename;
            }
        }

        // Generate a unique message ID before sending
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substr(2, 9);
        const messageId = `media_url_${timestamp}_${uniqueId}`;

        // Send media message
        try {
            const sentMessage = await client.sendMessage(chatId, media, { 
                caption: caption || undefined 
            });

            // Try to extract real message ID if available
            const realMessageId = extractMessageId(sentMessage, 'media_url');

            res.json({
                success: true,
                message: 'Media sent successfully',
                messageId: realMessageId !== `media_url_${timestamp}_${uniqueId}` ? realMessageId : messageId,
                to: formattedNumber,
                mediaType: mediaType,
                mediaSource: mediaUrl.startsWith('data:') ? 'base64' : 'url',
                caption: caption || null,
                timestamp: new Date().toISOString(),
                deliveryStatus: 'sent'
            });
        } catch (sendError) {
            throw sendError; // Re-throw to be caught by outer catch block
        }

    } catch (error) {
        console.error('Error sending media from URL:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send media: ' + error.message
        });
    }
});

// Get supported media types endpoint
app.get('/api/media-types', (req, res) => {
    res.json({
        success: true,
        supportedTypes: {
            images: [
                'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'
            ],
            documents: [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.ms-powerpoint',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'text/plain',
                'text/csv'
            ],
            audio: [
                'audio/mpeg', 'audio/wav', 'audio/ogg'
            ],
            video: [
                'video/mp4', 'video/avi', 'video/mov', 'video/wmv'
            ]
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
    if (client) {
        await client.destroy();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    if (client) {
        await client.destroy();
    }
    process.exit(0);
});

app.listen(PORT, () => {
    console.log('\n' + '🌟'.repeat(25));
    console.log('📱 WHATSAPP API SERVER STARTED 📱');
    console.log('🌟'.repeat(25));
    console.log(`🚀 Server running on: http://localhost:${PORT}`);
    console.log(`🌐 Web Dashboard: http://localhost:${PORT}`);
    console.log(`📡 API Base URL: http://localhost:${PORT}/api`);
    console.log('🌟'.repeat(25));
    console.log('\n⏳ Initializing WhatsApp client...');
    console.log('📱 QR Code will appear below when ready for scanning\n');
});
