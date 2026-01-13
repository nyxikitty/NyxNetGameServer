# System Architecture

## Overview

This is a distributed game server infrastructure built with TypeScript and Node.js, featuring a custom binary protocol for efficient network communication.

## Core Components

### 1. Name Server (Service Discovery)
- **Port**: 8888
- **Purpose**: Maintains registry of all servers
- **Functions**:
  - Server registration/unregistration
  - Health checking (heartbeat monitoring)
  - Server list queries
  - Load-aware routing

### 2. Master Server (Authentication & Matchmaking)
- **Port**: 9000
- **Purpose**: Player authentication and matchmaking
- **Functions**:
  - Multi-plugin authentication system
  - Player session management
  - Matchmaking queue processing
  - Token verification
- **Auth Plugins**:
  - SimpleAuth: Username/password with auto-registration
  - OAuth: OAuth 2.0 authorization code and client credentials
  - API Key: Server-to-server authentication

### 3. Game Servers (Game Logic)
- **Ports**: 9001, 9002, 9003
- **Purpose**: Handle game rooms and player interactions
- **Functions**:
  - Room creation and management
  - Player state synchronization
  - RPC (Remote Procedure Call) handling
  - Entity management
- **Scalability**: Multiple instances for load distribution

### 4. Chat Server (Text Messaging)
- **Port**: 9100
- **Purpose**: Text-based communication
- **Functions**:
  - Public chat rooms
  - Direct messages
  - Message history (configurable limit)
  - Typing indicators
  - User presence

### 5. Voice Server (Voice Communication)
- **Port**: 9200
- **Purpose**: Voice chat coordination
- **Functions**:
  - Voice channel management
  - WebRTC signaling
  - Mute/unmute functionality
  - Peer connection coordination

## Protocol Design

### Binary Protocol Features
- **Magic Bytes**: 0x42 0x4E (BN)
- **Version**: 0x01
- **Encryption**: Optional XOR cipher
- **Checksumming**: XOR-based checksum for integrity
- **Variable-Length Encoding**: VarInt/VarLong for efficient size encoding

### Data Types
- Primitives: NULL, BOOL, BYTE, SHORT, INT, LONG, FLOAT, DOUBLE
- Complex: STRING, BYTES, ARRAY, MAP
- Specialized: VEC2, VEC3 for 3D coordinates

### Packet Flow

```
Client → Master Server: PLAYER_LOGIN
Master Server → Client: Authentication Result + Token
Client → Name Server: GET_GAME_SERVERS
Name Server → Client: Available Game Servers
Client → Game Server: JOIN_ROOM
Game Server → Clients: PLAYER_UPDATE (broadcast)
```

## Authentication Flow

### SimpleAuth
```
1. Client sends username + password
2. Server checks if user exists
3. If not, auto-register new user
4. Generate and return session token
```

### OAuth
```
1. Client requests authorization
2. Server generates auth code
3. Client exchanges code for access token
4. Token used for subsequent requests
```

### API Key
```
1. Admin creates API key via RPC
2. Key stored with permissions and rate limits
3. Clients authenticate with API key + App ID
4. Request count tracked for rate limiting
```

## Load Balancing

The Name Server tracks server load and provides clients with the least-loaded server:

```
1. Each server sends heartbeat with current player count
2. Name Server sorts by load on query
3. Clients connect to recommended server
4. Timeout removes unresponsive servers
```

## Matchmaking Algorithm

```typescript
1. Players queue with game mode and preferences
2. Every second, process queues:
   a. Group by game mode
   b. If enough players (minPlayers), create match
   c. Notify all matched players
   d. Provide game server assignment
```

## Scalability Considerations

### Horizontal Scaling
- Add more Game Server instances
- Name Server automatically discovers new servers
- Load distribution happens naturally

### Vertical Scaling
- Increase capacity per server
- Adjust room limits
- Tune heartbeat intervals

### Bottlenecks
- Name Server: Single point of failure (could be replicated)
- Master Server: Authentication load (could shard by user ID)
- Network: Protocol is optimized but consider compression

## Security

### Current Implementation
- Optional XOR encryption (lightweight)
- Checksum validation
- Token-based authentication
- Rate limiting in API Key plugin

### Production Recommendations
1. Use TLS/SSL for transport security
2. Implement stronger encryption (AES)
3. Add DDoS protection
4. Implement IP-based rate limiting
5. Add admin authentication system
6. Use secure random for token generation
7. Implement token refresh mechanism

## Monitoring & Debugging

### Key Metrics
- Server health (heartbeat status)
- Player counts per server
- Matchmaking queue size
- Authentication success/failure rates
- Room occupancy

### Logging
- Configurable log levels
- Server-specific prefixes
- Timestamp all events
- Connection lifecycle logging

## Future Enhancements

1. **Persistence Layer**: Database integration for player data
2. **Analytics**: Game telemetry and player behavior tracking
3. **Admin Panel**: Web interface for server management
4. **Replay System**: Record and replay game sessions
5. **Anti-Cheat**: Server-side validation and anomaly detection
6. **Cross-Server Communication**: Players across game servers
7. **Dynamic Server Provisioning**: Auto-scale based on load
8. **Redis Integration**: Distributed caching and pub/sub
