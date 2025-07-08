# WhatsApp API Server 📱

A robust, production-ready multi-session WhatsApp API server built with Express.js and whatsapp-web.js. Supports unlimited WhatsApp numbers, dynamic session management, and multiple deployment options.

## 🚀 Features

- **Multi-Session Support**: Manage unlimited WhatsApp numbers
- **Dynamic Session Management**: Add/remove sessions via API
- **QR Code Authentication**: Web-based QR scanning
- **Message Types**: Text and media messages (images, documents, audio, video)
- **Persistence Options**: SQLite database or JSON file storage
- **Web Dashboard**: Modern UI for session and message management
- **Production Ready**: Docker support, PM2 configuration, load balancing
- **Multiple Deployment Options**: Local, Docker, Digital Ocean, Vercel

## 📋 Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Server Variants](#server-variants)
- [API Documentation](#api-documentation)
- [Web Dashboard](#web-dashboard)
- [Deployment](#deployment)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

## 🛠️ Installation

### Prerequisites

- Node.js 18+ (for SQLite version) or Node.js 16+ (for simple version)
- npm or yarn
- Linux/macOS (recommended) or Windows

### Clone Repository

```bash
git clone <your-repo-url>
cd WA-AUTO
npm install
```

## 🎯 Quick Start

### Option 1: SQLite-based Server (Recommended)

```bash
# Start SQLite-based server with persistence
node server-sqlite.js

# Access dashboard at http://localhost:3000
```

### Option 2: Simple File-based Server

```bash
# Start simple file-based server (Node.js 16+ compatible)
node server-simple.js

# Access dashboard at http://localhost:3001
```

### Option 3: Static Multi-session Server

```bash
# Start with predefined sessions
node server-multi.js

# Access dashboard at http://localhost:3002
```

### Option 4: Original Single Session Server

```bash
# Start original single session server
node server.js

# Access dashboard at http://localhost:3000
```

## 🔧 Server Variants

| Server File | Storage | Node.js | Features |
|-------------|---------|---------|----------|
| `server-sqlite.js` | SQLite Database | 18+ | Full API, unlimited sessions, persistence |
| `server-simple.js` | JSON Files | 16+ | Full API, file-based storage |
| `server-multi.js` | Memory | 16+ | Static sessions, web dashboard |
| `server.js` | Memory | 16+ | Single session, basic API |

## 📚 API Documentation

### Base URL
```
http://localhost:3000
```

### Authentication
No authentication required for local deployment. For production, implement authentication middleware.

---

## 🔗 Session Management APIs

### 1. Get All Sessions
```http
GET /api/sessions
```

**Response:**
```json
{
  "success": true,
  "sessions": [
    {
      "id": "whatsapp1",
      "name": "Primary WhatsApp",
      "description": "Main business account",
      "phone": "1234567890",
      "ready": true,
      "authenticated": true,
      "status": "ready",
      "created_at": "2025-07-08T10:00:00.000Z",
      "connected_at": "2025-07-08T10:05:00.000Z"
    }
  ]
}
```

### 2. Create New Session
```http
POST /api/sessions
Content-Type: application/json

{
  "sessionId": "whatsapp2",
  "sessionName": "Secondary WhatsApp",
  "description": "Customer support account"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Session created successfully",
  "sessionId": "whatsapp2"
}
```

### 3. Bulk Create Sessions
```http
POST /api/sessions/bulk
Content-Type: application/json

{
  "sessions": [
    {
      "sessionId": "wa1",
      "sessionName": "WhatsApp 1",
      "description": "Sales team"
    },
    {
      "sessionId": "wa2",
      "sessionName": "WhatsApp 2",
      "description": "Support team"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Created 2 sessions successfully",
  "created": ["wa1", "wa2"],
  "failed": []
}
```

### 4. Initialize Session
```http
POST /api/sessions/{sessionId}/initialize
```

**Response:**
```json
{
  "success": true,
  "message": "Session initialization started"
}
```

### 5. Get QR Code
```http
GET /api/sessions/{sessionId}/qr
```

**Response:**
```json
{
  "success": true,
  "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "message": "QR code ready for scanning"
}
```

### 6. Logout Session
```http
POST /api/sessions/{sessionId}/logout
```

**Response:**
```json
{
  "success": true,
  "message": "Session logged out successfully"
}
```

### 7. Delete Session
```http
DELETE /api/sessions/{sessionId}
```

**Response:**
```json
{
  "success": true,
  "message": "Session deleted successfully"
}
```

---

## 💬 Messaging APIs

### 1. Send Text Message
```http
POST /api/send
Content-Type: application/json

{
  "to": "1234567890",
  "message": "Hello from WhatsApp API!",
  "sessionId": "whatsapp1"
}
```

**Parameters:**
- `to` (required): Phone number (with or without country code)
- `message` (required): Text message content
- `sessionId` (optional): Specific session ID. If not provided, uses round-robin selection

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "sessionId": "whatsapp1",
  "sessionName": "Primary WhatsApp",
  "fromPhone": "1234567890",
  "messageId": "msg_12345"
}
```

### 2. Send Media Message
```http
POST /api/send-media
Content-Type: multipart/form-data

to: 1234567890
media: [file]
caption: Optional caption text
sessionId: whatsapp1
```

**Parameters:**
- `to` (required): Phone number
- `media` (required): File upload (images, documents, audio, video)
- `caption` (optional): Media caption
- `sessionId` (optional): Specific session ID

**Supported File Types:**
- Images: JPG, PNG, GIF, WebP
- Documents: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV
- Audio: MP3, WAV, OGG, M4A
- Video: MP4, AVI, MOV, WebM

**Response:**
```json
{
  "success": true,
  "message": "Media sent successfully",
  "sessionId": "whatsapp1",
  "sessionName": "Primary WhatsApp",
  "fromPhone": "1234567890",
  "mediaType": "image",
  "fileName": "photo.jpg"
}
```

### 3. Original Single Session APIs (server.js)

#### Send Message (Original API)
```http
POST /api/send-message
Content-Type: application/json

{
  "number": "9876543210",
  "message": "Hello from WhatsApp API!"
}
```

#### Send Media (Original API)
```http
POST /api/send-media
Content-Type: multipart/form-data

number: 9876543210
caption: Check this out!
media: [file]
```

#### Get Status
```http
GET /api/status
```

**Response:**
```json
{
  "authenticated": true,
  "ready": true,
  "hasQrCode": false
}
```

#### Get QR Code (Original)
```http
GET /api/qr
```

**Response:**
```json
{
  "success": true,
  "qrCode": "data:image/png;base64,..."
}
```

---

## 📊 Statistics & Information APIs

### 1. Get Server Statistics
```http
GET /api/stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalSessions": 5,
    "readySessions": 3,
    "authenticatedSessions": 4,
    "totalMessages": 150,
    "activeClients": 3,
    "databaseSize": 2048,
    "uptime": "2 hours 30 minutes"
  }
}
```

### 2. Get Recent Messages
```http
GET /api/messages?limit=20&offset=0
```

**Parameters:**
- `limit` (optional): Number of messages to retrieve (default: 20)
- `offset` (optional): Number of messages to skip (default: 0)

**Response:**
```json
{
  "success": true,
  "messages": [
    {
      "id": 1,
      "session_id": "whatsapp1",
      "to_number": "1234567890",
      "content": "Hello World",
      "media_type": null,
      "file_name": null,
      "timestamp": "2025-07-08T10:30:00.000Z"
    }
  ],
  "total": 150
}
```

### 3. Health Check
```http
GET /api/health
```

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2025-07-08T10:00:00.000Z",
  "version": "1.0.0"
}
```

### 4. Get Media Types (Original API)
```http
GET /api/media-types
```

### 5. Get Chat Info (Original API)
```http
GET /api/chat-info/:number
```

**Response:**
```json
{
  "success": true,
  "contact": {
    "id": "919876543210@c.us",
    "name": "Contact Name",
    "number": "919876543210",
    "isBlocked": false,
    "isGroup": false,
    "isMyContact": true
  }
}
```

---

## 🌐 Web Dashboard

Access the web dashboard at:
- SQLite Server: `http://localhost:3000`
- Simple Server: `http://localhost:3001`
- Multi Server: `http://localhost:3002`
- Original Server: `http://localhost:3000`

### Dashboard Features:
- **Session Management**: Create, initialize, and delete sessions
- **QR Code Display**: Modal popup for easy scanning
- **Message Sending**: Text and media message forms
- **Real-time Stats**: Live session and message statistics
- **Bulk Operations**: Create multiple sessions at once
- **Auto-refresh**: Updates every 10 seconds

---

## 🚀 Deployment

### Local Development

```bash
# Install dependencies
npm install

# Start SQLite server
node server-sqlite.js

# Start simple server (for older Node.js)
node server-simple.js
```

### Docker Deployment

#### Development
```bash
docker-compose up -d
```

#### Production
```bash
docker-compose -f docker-compose.production.yml up -d
```

### Digital Ocean Droplet

For Node.js v16 (your current version), use the simple server:

```bash
# Clone repository
git clone <your-repo-url>
cd WA-AUTO

# Install dependencies
npm install

# Start simple server (compatible with Node.js 16+)
node server-simple.js
```

### PM2 Process Manager

```bash
# Install PM2
npm install -g pm2

# Start simple server with PM2
pm2 start server-simple.js --name "whatsapp-api"

# Save PM2 configuration
pm2 save
pm2 startup
```

---

## 🔧 Environment Variables

Create a `.env` file in the project root:

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Database (SQLite only)
DB_PATH=./whatsapp.db

# Sessions (Simple server only)
SESSIONS_FILE=./sessions.json
MESSAGES_FILE=./messages.json

# WhatsApp Configuration
WHATSAPP_SESSION_PATH=./.wwebjs_auth
WHATSAPP_CACHE_PATH=./.wwebjs_cache

# Security (for production)
SESSION_SECRET=your-secret-key-here
API_KEY=your-api-key-here

# CORS Settings
CORS_ORIGIN=*

# File Upload Limits
MAX_FILE_SIZE=50MB
UPLOAD_DIR=./uploads

# Default Country Code (for original server)
DEFAULT_COUNTRY_CODE=91
```

---

## 🐛 Troubleshooting

### Common Issues

#### 1. Node.js Version Compatibility (Your Current Issue)

Your Digital Ocean droplet has Node.js v16.16.0, but `better-sqlite3` requires Node.js 20+. **Solution**: Use the simple server instead:

```bash
# Instead of server-sqlite.js, use:
node server-simple.js

# This works with Node.js 16+ and uses JSON files for storage
```

#### 2. SQLite Installation Issues

If you get SQLite build errors:
```bash
# Use the simple server instead
node server-simple.js

# Or upgrade Node.js to 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### 3. WhatsApp Connection Issues
- Ensure phone has stable internet connection
- Make sure WhatsApp Web is not active on other devices
- Try refreshing QR code if it expires
- Check firewall settings for port access

#### 4. File Upload Issues
- Check file size limits (default: 50MB)
- Verify file type is supported
- Ensure uploads directory exists and is writable

#### 5. Puppeteer/Chrome Issues
```bash
# Install missing dependencies on Linux
sudo apt-get install -y gconf-service libasound2-dev libatk1.0-dev libc6-dev libcairo2-dev libcups2-dev libdbus-1-dev libexpat1-dev libfontconfig1-dev libgcc1 libgconf-2-4 libgdk-pixbuf2.0-dev libglib2.0-dev libgtk-3-dev libnspr4-dev libpango-1.0-dev libpangocairo-1.0-dev libstdc++6 libx11-dev libx11-xcb-dev libxcomposite-dev libxcursor-dev libxdamage-dev libxext-dev libxfixes-dev libxi-dev libxrandr-dev libxrender-dev libxss-dev libxtst-dev ca-certificates fonts-liberation libappindicator1 libnss3-dev lsb-release xdg-utils wget
```

### Error Codes

| Code | Description | Solution |
|------|-------------|----------|
| 1001 | Session not found | Create session first |
| 1002 | Session not ready | Initialize and scan QR code |
| 1003 | Invalid phone number | Use format: 1234567890 or +911234567890 |
| 1004 | File too large | Reduce file size or increase limit |
| 1005 | Database error | Check database permissions |
| EBADENGINE | Node.js version incompatible | Use server-simple.js for Node.js 16+ |

---

## 📝 API Response Format

All API responses follow this standard format:

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {},
  "timestamp": "2025-07-08T10:00:00.000Z"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error description",
  "code": 1001,
  "timestamp": "2025-07-08T10:00:00.000Z"
}
```

---

## 🔐 Security Considerations

### For Production Use:

1. **Enable Authentication**:
```javascript
// Add API key middleware
app.use('/api', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
});
```

2. **Configure CORS**:
```javascript
app.use(cors({
  origin: ['https://yourdomain.com'],
  credentials: true
}));
```

3. **Rate Limiting**:
```javascript
const rateLimit = require('express-rate-limit');
app.use('/api/send', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
}));
```

4. **HTTPS**: Always use HTTPS in production

---

## 📞 Support

For issues and questions:
1. Check the troubleshooting section above
2. Review server logs: `pm2 logs` or `docker logs`
3. Create an issue in the repository
4. Check WhatsApp Web.js documentation

---

## 📄 License

This project is licensed under the MIT License. See LICENSE file for details.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

---

## 📚 Additional Resources

- [WhatsApp Web.js Documentation](https://wwebjs.dev/)
- [Express.js Documentation](https://expressjs.com/)
- [PM2 Documentation](https://pm2.keymetrics.io/)
- [Docker Documentation](https://docs.docker.com/)

---

**Happy messaging! 🎉**
