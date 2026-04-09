# MedTrap Backend

A robust backend API for the MedTrap medical store application with MongoDB integration and Cloudinary image storage.

## 🚀 Features

- **User Authentication**: JWT-based authentication with bcrypt password hashing
- **Image Upload**: Cloudinary integration for drug license image storage
- **MongoDB**: Efficient data storage with Mongoose ODM
- **Security**: Rate limiting, CORS protection, and input validation
- **File Handling**: Multer middleware for file uploads with automatic cleanup
- **Error Handling**: Comprehensive error handling and validation

## 📋 Prerequisites

- Node.js (v14 or higher)
- MongoDB Atlas account
- Cloudinary account

## 🛠️ Installation

1. **Clone the repository**

   ```bash
   cd Backend
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Environment Configuration**

   - Create a `config.env` or `.env` file at the project root and set the required variables. Update the following variables:
     ```env
     MONGO_URI=your_mongodb_connection_string
     JWT_SECRET=your_jwt_secret_key
     CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
     CLOUDINARY_API_KEY=your_cloudinary_api_key
     CLOUDINARY_API_SECRET=your_cloudinary_api_secret
     ```

4. **Start the server**

   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm start
   ```

## 🌐 API Endpoints

### Authentication Routes

#### POST `/api/auth/signup`

Register a new medical store.

**Request Body (multipart/form-data):**

```json
{
  "medicalName": "ABC Medical Store",
  "ownerName": "John Doe",
  "address": "123 Main Street, City",
  "email": "john@example.com",
  "contactNo": "+1234567890",
  "drugLicenseNo": "DL123456",
  "password": "securepassword123",
  "drugLicenseImage": [file]
}
```

**Response:**

```json
{
  "success": true,
  "message": "Medical store registered successfully",
  "user": {
    "_id": "user_id",
    "medicalName": "ABC Medical Store",
    "ownerName": "John Doe",
    "email": "john@example.com",
    "drugLicenseImage": "https://res.cloudinary.com/...",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### POST `/api/auth/login`

Authenticate user and get JWT token.

**Request Body:**

```json
{
  "email": "john@example.com",
  "password": "securepassword123"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Login successful",
  "token": "jwt_token_here",
  "user": {
    "_id": "user_id",
    "medicalName": "ABC Medical Store",
    "email": "john@example.com"
  }
}
```

#### GET `/api/auth/me`

Get current user profile (requires authentication).

**Headers:**

```
Authorization: Bearer <jwt_token>
```

**Response:**

```json
{
  "success": true,
  "user": {
    "_id": "user_id",
    "medicalName": "ABC Medical Store",
    "ownerName": "John Doe",
    "email": "john@example.com",
    "drugLicenseImage": "https://res.cloudinary.com/..."
  }
}
```

#### PUT `/api/auth/profile`

Update user profile (requires authentication).

**Headers:**

```
Authorization: Bearer <jwt_token>
```

**Request Body (multipart/form-data):**

```json
{
  "medicalName": "Updated Medical Store",
  "ownerName": "John Doe",
  "address": "New Address",
  "contactNo": "+1234567890",
  "drugLicenseImage": [file] // Optional
}
```

### Health Check

#### GET `/health`

Check server status.

**Response:**

```json
{
  "success": true,
  "message": "MedTrap Backend is running",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.456
}
```

## 🔒 Security Features

- **Rate Limiting**: 5 requests per 15 minutes for auth routes
- **JWT Authentication**: Secure token-based authentication
- **Password Hashing**: bcrypt with salt rounds
- **Input Validation**: Comprehensive field validation
- **CORS Protection**: Configurable cross-origin resource sharing
- **Security Headers**: XSS protection and content type options

## 📁 Project Structure

```
Backend/
├── config/
│   └── cloudinary.js      # Cloudinary configuration
├── middleware/
│   ├── auth.js            # Authentication middleware
│   └── upload.js          # File upload middleware
├── models/
│   └── User.js            # User data model
├── routes/
│   └── auth.js            # Authentication routes
├── uploads/                # Temporary file storage
├── config.env              # Environment variables
├── package.json            # Dependencies
├── server.js               # Main server file
└── README.md               # This file
```

## 🗄️ Database Schema

### User Model

```javascript
{
  medicalName: String (required, max 100 chars),
  ownerName: String (required, max 50 chars),
  address: String (required, max 200 chars),
  email: String (required, unique, lowercase),
  contactNo: String (required, pattern matched),
  drugLicenseNo: String (required, unique, uppercase),
  drugLicenseImage: String (required, Cloudinary URL),
  password: String (required, min 6 chars, hashed),
  isVerified: Boolean (default: false),
  role: String (enum: ['user', 'admin'], default: 'user'),
  createdAt: Date,
  updatedAt: Date
}
```

## 🚀 Deployment

### Environment Variables

Ensure all required environment variables are set in your production environment:

```bash
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/database
JWT_SECRET=your_very_secure_jwt_secret
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
PORT=5000
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.com
```

### Production Considerations

- Use environment variables for sensitive data
- Set up proper MongoDB indexes
- Configure CORS for production domains
- Set up monitoring and logging
- Use HTTPS in production
- Consider using PM2 or similar process manager

## 🐛 Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**

   - Check your connection string
   - Ensure network access is allowed
   - Verify database credentials

2. **Cloudinary Upload Failed**

   - Check API credentials
   - Verify cloud name
   - Check file size limits

3. **JWT Token Invalid**
   - Ensure JWT_SECRET is set
   - Check token expiration
   - Verify token format

### Logs

The server provides detailed logging for debugging:

- Request logs with timestamps
- Error logs with stack traces
- MongoDB connection status
- File upload status

### Forgot-password / Email troubleshooting

- Ensure `FRONTEND_BASE_URL` (or `FRONTEND_URL`) is set in production to your frontend origin, e.g.:

```env
FRONTEND_BASE_URL=https://medi-trap-frontend.vercel.app
```

- To help debug email delivery from the deployed process, set `DEBUG_EMAIL=true` temporarily. When enabled the `POST /api/auth/forgot-password` response will include a `debug.mailError` field containing the mailer error string (safe to use only temporarily in non-public environments).

```env
DEBUG_EMAIL=true
```

Remember to remove `DEBUG_EMAIL` after diagnosing the issue so you don't leak internal errors to clients.

### Production SMTP diagnostic endpoint

If you cannot SSH into the host, you can run a protected SMTP diagnostic from the running process using the `/debug/email-check` endpoint.

- Set a secret token in the deployment environment:

```env
DEBUG_TOKEN=some-long-secret-token
```

- Deploy the update. Then call the endpoint (from a safe environment) with the header `x-debug-token: <token>` and a JSON body `{ "to": "you@example.com" }`.

Example curl (use in your machine or Render's deploy console):

```bash
curl -X POST https://<your-backend>/debug/email-check \
  -H "Content-Type: application/json" \
  -H "x-debug-token: some-long-secret-token" \
  -d '{"to":"you@example.com"}'
```

The endpoint will attempt to verify the transporter and send a small test message using the same environment credentials your app uses. It returns the `messageId` and accepted/rejected arrays so you can confirm whether the mail was accepted by the SMTP provider.

### Diagnostic: fetch image from Cloudinary

If users see network errors when loading images (for example `net::ERR_CONNECTION_RESET`), you can run a server-side diagnostic to inspect headers and attempt a small ranged download from Cloudinary. This is useful to determine whether the deployed host can reach Cloudinary and whether intermediate proxies are truncating connections.

- Set `DEBUG_TOKEN` as described above.
- POST to `/debug/fetch-image` with JSON `{ "url": "https://res.cloudinary.com/your-cloud/.../image.png" }` and header `x-debug-token: <token>`.

Example:

```bash
curl -X POST https://<your-backend>/debug/fetch-image \
  -H "Content-Type: application/json" \
  -H "x-debug-token: some-long-secret-token" \
  -d '{"url":"https://res.cloudinary.com/dspnmgzwh/image/upload/v1759225595/t1epeuj4f4mqtkrx412x.png"}'
```

The response will include the HEAD status/headers and the small ranged GET result (status, headers, and how many bytes were received). If you see connection resets or truncated responses from the deployed host but not locally, inspect your hosting provider's network/firewall or contact Cloudinary support with the timestamps.

## 📝 License

This project is licensed under the MIT License.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For support and questions, please contact the development team or create an issue in the repository.

## ⚠️ Security note

- Do NOT commit your `Backend/.env` to version control. It contains secrets (DB credentials, API keys, SMTP passwords).
- If you find any secrets committed to the repository history, rotate those credentials (Cloudinary API key/secret, Redis password, JWT secret) immediately.
  -- Ensure `.env` (or `config.env`) is documented and added to `.gitignore` so secrets are not committed.
