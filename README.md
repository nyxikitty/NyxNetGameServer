# Distributed Game Server Infrastructure

A production-ready, TypeScript-based distributed game server infrastructure with custom binary protocol, authentication plugins, and microservices architecture.

## Features

- **Custom Binary Protocol**: Efficient packet serialization with VarInt/VarLong encoding
- **Distributed Architecture**: Name Server, Master Server, Game Servers, Chat Server, Voice Server
- **Authentication Plugins**: SimpleAuth, OAuth, API Key authentication
- **Load Balancing**: Automatic server discovery and load distribution
- **Matchmaking**: Real-time player matchmaking system
- **Type-Safe**: Full TypeScript implementation with strict typing
- **Scalable**: Easily add more game server instances

## Architecture

```
┌─────────────┐
│ Name Server │ (Port 8888) - Service Discovery
└──────┬──────┘
       │
       ├──────────────────────────────────┐
       │                                  │
┌──────▼───────┐                  ┌──────▼──────┐
│Master Server │ (Port 9000)      │ Game Servers│
│- Auth        │                  │ (9001-9003) │
│- Matchmaking │                  │- Rooms      │
└──────────────┘                  │- Players    │
                                  └─────────────┘
       │
       ├──────────────────────────────────┐
       │                                  │
┌──────▼──────┐                  ┌───────▼──────┐
│ Chat Server │ (Port 9100)      │Voice Server  │
│- Text Chat  │                  │ (Port 9200)  │
│- DMs        │                  │- Voice Comms │
└─────────────┘                  └──────────────┘
```

## Installation

```bash
npm install
```

## Build

```bash
npm run build
```

## Run

```bash
# Development
npm run dev

# Production
npm start
```

## Project Structure

```
src/
├── protocol/          # Binary protocol implementation
│   ├── types.ts
│   ├── Packet.ts
│   ├── VarInt.ts
│   ├── VarLong.ts
│   ├── Checksum.ts
│   ├── Cipher.ts
│   ├── ProtocolReader.ts
│   └── ProtocolWriter.ts
├── auth/              # Authentication system
│   ├── AuthPlugin.ts
│   ├── AuthResult.ts
│   └── plugins/
│       ├── SimpleAuthPlugin.ts
│       ├── OAuthAuthPlugin.ts
│       └── APIKeyAuthPlugin.ts
├── servers/           # Server implementations
│   ├── NameServer.ts
│   ├── MasterServer.ts
│   ├── GameServer.ts
│   ├── ChatServer.ts
│   └── VoiceServer.ts
├── models/            # Data models
│   ├── Player.ts
│   ├── Room.ts
│   ├── ChatRoom.ts
│   └── VoiceChannel.ts
└── index.ts           # Main entry point
```

## Protocol

### Packet Structure

```
[Magic: 0x42 0x4E] [Version: 0x01] [Flags] [Opcode] [Length: VarInt] [Payload] [Checksum]
```

### Opcodes

- Authentication: `AUTH`, `PLAYER_LOGIN`, `PLAYER_LOGOUT`
- Server Management: `REGISTER_SERVER`, `SERVER_LIST`, `PING`, `PONG`
- Game: `CREATE_ROOM`, `JOIN_ROOM`, `LEAVE_ROOM`, `PLAYER_UPDATE`
- Chat: `CHAT_MESSAGE`, `CHAT_ROOM_JOIN`, `CHAT_DIRECT_MESSAGE`
- Voice: `VOICE_JOIN_CHANNEL`, `VOICE_DATA`, `VOICE_MUTE`

## Authentication

### SimpleAuth
Username/password authentication with auto-registration.

### OAuth
OAuth 2.0 flow with authorization code and client credentials grants.

### API Key
API key-based authentication for server-to-server communication.

## License

MIT
