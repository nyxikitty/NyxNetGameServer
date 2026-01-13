export enum TYPE {
  NULL = 0x00,
  BOOL = 0x01,
  BYTE = 0x02,
  SHORT = 0x03,
  INT = 0x04,
  LONG = 0x05,
  FLOAT = 0x06,
  DOUBLE = 0x07,
  STRING = 0x08,
  BYTES = 0x09,
  ARRAY = 0x0a,
  MAP = 0x0b,
  VEC2 = 0x0c,
  VEC3 = 0x0d,
}

export enum OPCODE {
  HANDSHAKE = 0x47,
  AUTH = 0x92,
  DISCONNECT = 0x1f,
  PING = 0x33,
  PONG = 0x34,
  SERVER_LIST = 0x50,
  SERVER_INFO = 0x51,
  REGISTER_SERVER = 0x52,
  UNREGISTER_SERVER = 0x53,
  PLAYER_LOGIN = 0x60,
  PLAYER_LOGOUT = 0x61,
  GET_GAME_SERVERS = 0x62,
  MATCHMAKING_REQUEST = 0x63,
  MATCHMAKING_FOUND = 0x64,
  AUTH_PLUGIN_REGISTER = 0x65,
  AUTH_PLUGIN_VERIFY = 0x66,
  CREATE_ROOM = 0x5a,
  JOIN_ROOM = 0x3c,
  LEAVE_ROOM = 0x8d,
  ROOM_LIST = 0x6e,
  PLAYER_UPDATE = 0xa4,
  SPAWN_ENTITY = 0xb7,
  DESTROY_ENTITY = 0x2b,
  RPC_CALL = 0xd9,
  RPC_RESPONSE = 0x4f,
  STATE_UPDATE = 0x7c,
  FULL_STATE = 0xe1,
  CHAT_MESSAGE = 0x70,
  CHAT_ROOM_JOIN = 0x71,
  CHAT_ROOM_LEAVE = 0x72,
  CHAT_ROOM_LIST = 0x73,
  CHAT_DIRECT_MESSAGE = 0x74,
  CHAT_USER_LIST = 0x75,
  CHAT_TYPING = 0x76,
  VOICE_JOIN_CHANNEL = 0x80,
  VOICE_LEAVE_CHANNEL = 0x81,
  VOICE_DATA = 0x82,
  VOICE_MUTE = 0x83,
  VOICE_UNMUTE = 0x84,
  VOICE_USER_LIST = 0x85,
  VOICE_PEER_INFO = 0x86,
}

export enum SERVER_TYPE {
  NAME = 'name',
  MASTER = 'master',
  GAME = 'game',
  CHAT = 'chat',
  VOICE = 'voice',
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PacketData {
  [key: string]: any;
}

export interface ParsedPacket {
  opcode: OPCODE;
  data: PacketData;
  isEncrypted: boolean;
}

export type ProtocolValue =
  | null
  | boolean
  | number
  | string
  | Buffer
  | Vec2
  | Vec3
  | ProtocolValue[]
  | { [key: string]: ProtocolValue };
