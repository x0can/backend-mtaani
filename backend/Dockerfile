FROM node:20-alpine

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production
RUN npm install


# Copy source code
COPY . .

# Expose your server port
EXPOSE 5000

# Start server
CMD ["npm", "run", "dev"]
