import nodemailer, { Transporter } from 'nodemailer';
import { mailConfig } from '../config/mail.config';

export class EmailService {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
      ignoreTLS: true, // For local dev with Mailhog
      secure: false,
    });
  }

  /**
   * Send an email with error handling.
   */
  public async sendMail(options: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: mailConfig.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      console.log(`[EmailService] Email sent to ${options.to}: ${options.subject}`);
      return true;
    } catch (error) {
      console.error(`[EmailService] Failed to send email to ${options.to}:`, error);
      // In local dev without active Mailhog server running, log error without crashing the caller
      return false;
    }
  }

  /**
   * Send an account email verification link.
   */
  public async sendVerificationEmail(email: string, token: string): Promise<boolean> {
    const verificationUrl = `${mailConfig.appUrl}/api/auth/verify?token=${token}`;

    const subject = 'Verify your DockSlot account';
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #2563eb;">Welcome to DockSlot!</h2>
        <p>Thank you for signing up. Please click the button below to verify your email address and activate full permissions for your account.</p>
        <div style="margin: 30px 0;">
          <a href="${verificationUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Verify Email Address</a>
        </div>
        <p>Or copy and paste this verification link into your browser:</p>
        <p><a href="${verificationUrl}" style="color: #2563eb; word-break: break-all;">${verificationUrl}</a></p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #777;">If you did not sign up for a DockSlot account, you can safely ignore this email.</p>
      </div>
    `;

    const text = `Welcome to DockSlot!\n\nPlease verify your email by opening the following link:\n${verificationUrl}\n\nIf you did not sign up for DockSlot, please ignore this email.`;

    return this.sendMail({ to: email, subject, html, text });
  }
}

export const emailService = new EmailService();
