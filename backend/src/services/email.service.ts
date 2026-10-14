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
    } catch (error: any) {
      if (error?.code === 'ECONNREFUSED') {
        console.warn(
          `[EmailService] SMTP server is not running on ${mailConfig.host}:${mailConfig.port}. (Email to ${options.to} not sent via SMTP).`
        );
      } else {
        console.error(`[EmailService] Failed to send email to ${options.to}:`, error?.message || error);
      }
      return false;
    }
  }

  /**
   * Send an account email verification link.
   */
  public async sendVerificationEmail(email: string, token: string): Promise<boolean> {
    const verificationUrl = `${mailConfig.appUrl}/api/auth/verify?token=${token}`;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[EmailService:DevPreview] Verification link for ${email}: ${verificationUrl}`);
    }

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

  /**
   * Send a password reset link email.
   */
  public async sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
    const resetUrl = `${mailConfig.frontendUrl}/reset-password?token=${token}`;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[EmailService:DevPreview] Password reset link for ${email}: ${resetUrl}`);
    }

    const subject = 'Reset your DockSlot password';
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #2563eb;">Password Reset Request</h2>
        <p>We received a request to reset your DockSlot account password. Click the button below to choose a new password:</p>
        <div style="margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Reset Password</a>
        </div>
        <p>This password reset link will expire in 1 hour.</p>
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="${resetUrl}" style="color: #2563eb; word-break: break-all;">${resetUrl}</a></p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #777;">If you did not request a password reset, please ignore this email or contact support if you suspect unauthorized activity.</p>
      </div>
    `;

    const text = `Reset your DockSlot password\n\nClick the link below to reset your password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, please ignore this email.`;

    return this.sendMail({ to: email, subject, html, text });
  }

  /**
   * Send an invitation email to a newly invited team member.
   */
  public async sendInvitationEmail(
    email: string,
    organizationName: string,
    role: string,
    token: string
  ): Promise<boolean> {
    const inviteUrl = `${mailConfig.frontendUrl}/accept-invite?token=${token}`;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[EmailService:DevPreview] Invitation link for ${email}: ${inviteUrl}`);
    }

    const subject = `You're invited to join ${organizationName} on DockSlot`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #2563eb;">Welcome to DockSlot!</h2>
        <p>You have been invited to join <strong>${organizationName}</strong> as a <strong>${role}</strong>.</p>
        <p>Click the link below to accept the invitation and activate your account:</p>
        <div style="margin: 30px 0;">
          <a href="${inviteUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Accept Invitation</a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="${inviteUrl}" style="color: #2563eb; word-break: break-all;">${inviteUrl}</a></p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #777;">If you were not expecting this invitation, you can safely ignore this email.</p>
      </div>
    `;

    const text = `You have been invited to join ${organizationName} as a ${role} on DockSlot.\n\nAccept your invitation: ${inviteUrl}`;

    return this.sendMail({ to: email, subject, html, text });
  }
}

export const emailService = new EmailService();
