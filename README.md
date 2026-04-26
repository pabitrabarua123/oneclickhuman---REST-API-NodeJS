# oneclickhuman---REST-API-NodeJS

A RESTful API for Oneclickhuman Project built with Node.js and Express.

## Core API Usage
- User registration and authentication
- Subscription and payment endpoints
- OTP verification
- OpenAI request and response sent back to client with streaming. 

## Project Structure
```
index.js                # Entry point
config/connection.js    # Database connection
controllers/            # Route handlers
models/                 # Database models
routes/                 # API routes
templates/views/        # Handlebars templates
public/images/          # Static assets
utils/prompt.js         # Utility functions
```

## Getting Started
1. Clone the repository
2. Run `npm install` to install dependencies
3. Configure your database in `config/connection.js`
4. Start the server: `node index.js`
5. Access API endpoints at `http://localhost:3000/`

## License
MIT

