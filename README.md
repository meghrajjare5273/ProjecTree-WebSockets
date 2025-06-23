Projectree WebSockets Server
This is a real-time chat server for the Projectree application, built with Node.js, Express, and Socket.IO. It provides real-time messaging capabilities, user authentication, and integrates with a PostgreSQL database using Prisma. The server also uses Redis for caching and managing user sessions.
Features

Real-time messaging using WebSockets
User authentication with Better Auth
Database integration with Prisma and PostgreSQL
Redis for caching and session management
Typing indicators and read receipts
Graceful shutdown and error handling

Technologies Used

Node.js
Express.js
Socket.IO
Better Auth
Prisma
PostgreSQL
Redis
TypeScript

Setup Instructions

Prerequisites:

Node.js >= 18.0.0
PostgreSQL
Redis


Clone the repository:
git clone https://github.com/meghrajjare5273/projectree-websockets.git
cd projectree-websockets


Install dependencies:
npm install


Set up the database:

Create a PostgreSQL database for the project.

Create a .env file in the root directory and add your database connection string:
DATABASE_URL=postgresql://user:password@localhost:5432/mydatabase




Set up Redis:

Ensure Redis is running.

Add the Redis connection string to your .env file:
REDIS_URL=redis://localhost:6379




Set up client URL:

Add the client application URL to your .env file:
CLIENT_URL=http://localhost:3000




Generate Prisma client:
npx prisma generate


Run database migrations:
npx prisma migrate dev


Start the server:
npm run dev



The server should now be running on http://localhost:3001.
Environment Variables

DATABASE_URL: Your PostgreSQL database connection string.
REDIS_URL: Your Redis connection string.
CLIENT_URL: The URL of your client application (e.g., http://localhost:3000).

Usage

Authentication: The server uses Better Auth for authentication. API endpoints are available under /api/auth/*.
Session: Get the current session with GET /api/me.
WebSockets: Connect to the server using Socket.IO at http://localhost:3001/socket.io/.

Socket.IO Events

join_chat: Join a chat room with another user.
send_message: Send a message to another user.
typing_start: Indicate that the user has started typing.
typing_stop: Indicate that the user has stopped typing.
mark_read: Mark messages as read.
get_conversations: Get the list of conversations.
load_more_messages: Load more messages in a conversation.

Testing
A simple test client is provided in test.html. Open this file in a browser to test the Socket.IO connection and send test messages.
Contributing
Contributions are welcome! Please open an issue or submit a pull request for any improvements or bug fixes.
License
This project is licensed under the MIT License.
