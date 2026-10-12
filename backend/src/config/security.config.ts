import dotenv from 'dotenv';

dotenv.config();

export const securityConfig = {
  jwtSecret: process.env.JWT_SECRET || 'default_secret_key',
  saltRounds: 10,
};
