import dotenv from 'dotenv';

dotenv.config();

export const mailConfig = {
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT) || 1025,
  from: process.env.SMTP_FROM || 'DockSlot <no-reply@dockslot.local>',
  appUrl: process.env.APP_URL || 'http://localhost:5000',
};
