# WhatsApp API Server

A powerful Express.js API for sending WhatsApp messages using QR-based authentication. This project uses `whatsapp-web.js` to interact with WhatsApp Web and provides a clean REST API interface.

## Features

- 🔐 **QR-based Authentication** - Secure login using WhatsApp QR code
- 📱 **Send Messages** - Send text messages to any WhatsApp number
- 📎 **Send Media** - Send images, PDFs, documents, audio, and video files
- 🌐 **Web Dashboard** - Beautiful web interface for easy testing
- 📊 **Status Monitoring** - Real-time connection status
- 🔄 **Auto-reconnection** - Handles disconnections gracefully
- 🛡️ **Input Validation** - Validates phone numbers and messages
- 📚 **API Documentation** - Complete API reference
- 💾 **Session Persistence** - Maintains authentication across restarts

## Quick Start

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

1. **Clone or download the project**
   ```bash
   cd WA-AUTO
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```

   For development with auto-reload:
   ```bash
   npm run dev
   ```

   To see all warnings (including deprecation warnings):
   ```bash
   npm run start-verbose
   # or
   npm run dev-verbose
   ```

4. **Open the dashboard**
   ```
   http://localhost:3000
   ```

## Usage

### 1. Authentication

1. Start the server
2. **The QR code will automatically appear in your terminal/console**
3. Scan the QR code with WhatsApp on your phone
4. Wait for authentication and ready status

**Note**: The QR code is displayed directly in the terminal for convenience. You can also visit the web dashboard at `http://localhost:3000` for a backup QR code if needed.

### 2. Send Messages

#### Via Web Dashboard
1. Ensure you're authenticated and ready
2. Enter phone number (with or without country code)
3. Type your message
4. Click "Send Message"

#### Via API (cURL)
```bash
# Send text message
curl -X POST http://localhost:3000/api/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "number": "9876543210",
    "message": "Hello from WhatsApp API!"
  }'

# Send media file
curl -X POST http://localhost:3000/api/send-media \
  -F "number=9876543210" \
  -F "caption=Check this out!" \
  -F "media=@/path/to/your/file.pdf"
```

#### Via API (JavaScript)
```javascript
// Send text message
const response = await fetch('http://localhost:3000/api/send-message', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    number: '9876543210',
    message: 'Hello from WhatsApp API!'
  })
});

// Send media file
const formData = new FormData();
formData.append('number', '9876543210');
formData.append('caption', 'Check this document!');
formData.append('media', fileInput.files[0]);

const mediaResponse = await fetch('http://localhost:3000/api/send-media', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result);
```

## API Endpoints

### `GET /api/status`
Check the connection status of WhatsApp client.

**Response:**
```json
{
  "authenticated": true,
  "ready": true,
  "hasQrCode": false
}
```

### `GET /api/qr`
Get QR code for WhatsApp authentication.

**Response:**
```json
{
  "success": true,
  "qrCode": "data:image/png;base64,..."
}
```

### `POST /api/send-message`
Send a WhatsApp message.

**Request Body:**
```json
{
  "number": "9876543210",
  "message": "Your message here"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "messageId": "3EB0C767D95D5B2E1A1E",
  "to": "919876543210",
  "content": "Your message here",
  "timestamp": "2025-06-26T10:30:00.000Z"
}
```

### `POST /api/send-media`
Send media files (images, PDFs, documents, audio, video).

**Request Body (multipart/form-data):**
- `number`: Phone number
- `media`: File to upload
- `caption`: Optional caption for the media

**Response:**
```json
{
  "success": true,
  "message": "Media sent successfully",
  "messageId": "3EB0C767D95D5B2E1A1E",
  "to": "919876543210",
  "mediaType": "application/pdf",
  "fileName": "document.pdf",
  "caption": "Important document",
  "timestamp": "2025-06-26T10:30:00.000Z"
}
```

### `GET /api/media-types`
Get supported media types and file size limits.

## Supported Media Types

- **Images**: JPEG, PNG, GIF, WebP
- **Documents**: PDF, Word, Excel, PowerPoint, TXT, CSV
- **Audio**: MP3, WAV, OGG
- **Video**: MP4, AVI, MOV, WMV
- **File Size Limit**: 16MB

For detailed media sending guide, see [MEDIA_GUIDE.md](MEDIA_GUIDE.md)

### `GET /api/chat-info/:number`
Get information about a contact.

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

### `POST /api/logout`
Logout from WhatsApp.

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

## Session Management

### Session Persistence
- ✅ **Persistent Sessions**: Once authenticated, your session remains active indefinitely
- 🔄 **Survives Restarts**: Authentication is saved locally and restored when you restart the server
- 📁 **Local Storage**: Session data is stored in `.wwebjs_auth/` directory
- 🚫 **No Re-auth Needed**: You won't need to scan QR code again unless you logout or clear session

### Session Endpoints
- `GET /api/session-info` - Get detailed session information
- `POST /api/clear-session` - Clear saved session (forces re-authentication)

For detailed session management, see [SESSION_MANAGEMENT.md](SESSION_MANAGEMENT.md)

## Phone Number Format

The API accepts phone numbers in various formats:

- `9876543210` (10-digit Indian number)
- `919876543210` (with country code)
- `+919876543210` (with + sign)

For non-Indian numbers, include the country code:
- `12345678900` (US number with country code)
- `447123456789` (UK number with country code)

## Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
PORT=3000
DEFAULT_COUNTRY_CODE=91
```

### Default Country Code

By default, the API assumes Indian phone numbers (+91). For 10-digit numbers without a country code, it automatically adds the Indian country code.

To change the default country code, modify the server.js file or use environment variables.

## Error Handling

The API provides detailed error messages for common issues:

- **Invalid phone number**: Number format validation
- **Unregistered number**: Number not found on WhatsApp
- **Not authenticated**: Client not logged in to WhatsApp
- **Client not ready**: WhatsApp client is connecting
- **Rate limiting**: WhatsApp Web rate limits

## Security Considerations

- The QR code provides full access to your WhatsApp account
- Run the server on a secure network
- Use environment variables for sensitive configuration
- Implement authentication for production use
- Monitor rate limits to avoid being blocked

## Troubleshooting

### Common Issues

1. **QR code not appearing**
   - Wait a few seconds after starting the server
   - Check console logs for errors
   - Restart the server

2. **Authentication fails**
   - Make sure you scan the QR code quickly
   - Ensure your phone has internet connection
   - Try logging out and scanning again

3. **Messages not sending**
   - Verify the phone number format
   - Check if the number is registered on WhatsApp
   - Ensure you're authenticated and ready

4. **Puppeteer errors**
   - Install missing dependencies: `sudo apt-get install -y gconf-service libasound2-dev libatk1.0-dev libc6-dev libcairo2-dev libcups2-dev libdbus-1-dev libexpat1-dev libfontconfig1-dev libgcc1 libgconf-2-4 libgdk-pixbuf2.0-dev libglib2.0-dev libgtk-3-dev libnspr4-dev libpango-1.0-dev libpangocairo-1.0-dev libstdc++6 libx11-dev libx11-xcb-dev libxcb1-dev libxcomposite-dev libxcursor-dev libxdamage-dev libxext-dev libxfixes-dev libxi-dev libxrandr-dev libxrender-dev libxss-dev libxtst-dev ca-certificates fonts-liberation libappindicator1 libnss3-dev lsb-release xdg-utils wget`

5. **Deprecation warnings**
   - The default `npm start` suppresses deprecation warnings for cleaner output
   - To see all warnings use `npm run start-verbose`
   - These warnings come from library dependencies and don't affect functionality

### Logs

Check the console output for detailed logs:
- QR code generation status
- Authentication events
- Message sending results
- Error details

## Development

### Project Structure

```
WA-AUTO/
├── server.js          # Main Express.js server
├── package.json       # Dependencies and scripts
├── .env              # Environment variables
├── public/
│   └── index.html    # Web dashboard
└── README.md         # This file
```

### Adding Features

The codebase is modular and easy to extend:

- Add new API endpoints in `server.js`
- Modify the web interface in `public/index.html`
- Extend WhatsApp functionality using `whatsapp-web.js` features

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review the console logs
3. Open an issue with detailed information

---

**⚠️ Disclaimer**: This project is for educational and personal use. Make sure to comply with WhatsApp's Terms of Service and avoid spam or abuse.
