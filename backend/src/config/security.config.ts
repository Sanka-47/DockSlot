import dotenv from 'dotenv';

dotenv.config();

export const securityConfig = {
  jwtSecret: process.env.JWT_SECRET || 'default_secret_key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  saltRounds: 10,
};
