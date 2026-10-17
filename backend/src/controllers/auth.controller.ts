import { Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { invitationService } from '../services/invitation.service';
import { totpService } from '../services/totp.service';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = {
      ...req.body,
      organizationName: req.body.organizationName || req.body.orgName,
      organizationType: req.body.organizationType || req.body.orgType,
    };
    const result = await authService.register(payload);
    res.status(201).json({
      success: true,
      message: 'User registered successfully. A verification email has been sent.',
      data: result,
      token: result.token,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred during registration.',
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await authService.login(req.body);
    if (result.requires2FA) {
      res.status(200).json({
        success: true,
        message: 'Two-factor authentication required.',
        requires2FA: true,
        tempToken: result.tempToken,
        data: result,
      });
      return;
    }
    res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: result,
      token: result.token,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred during login.',
    });
  }
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.body?.refreshToken ?? req.body?.refresh_token;
    const result = await authService.refresh(refreshToken);
    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully.',
      data: result,
      token: result.token,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred while refreshing the token.',
    });
  }
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.query.token as string;
    const result = await authService.verifyEmail(token);
    res.status(200).json({
      success: true,
      message: result.message,
      data: { email: result.email },
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Email verification failed.',
    });
  }
};

export const resendVerification = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = req.body.email;
    const userId = req.user?.userId;

    const result = await authService.resendVerification({ email, userId });
    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to resend verification email.',
    });
  }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    const result = await authService.forgotPassword(email);
    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred during password reset request.',
    });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body;
    const result = await authService.resetPassword(token, newPassword);
    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred during password reset.',
    });
  }
};

export const changePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication required to change password.',
      });
      return;
    }

    const result = await authService.changePassword({
      userId,
      oldPassword,
      newPassword,
    });

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred during password change.',
    });
  }
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user?.userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized.',
      });
      return;
    }

    const user = await authService.getUserById(req.user.userId);
    res.status(200).json({
      success: true,
      data: {
        ...user,
        tenantContext: req.tenant,
      },
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to retrieve user profile.',
    });
  }
};

export const acceptInvite = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body;
    const result = await invitationService.acceptInvitation({ token, password });
    res.status(201).json({
      success: true,
      message: 'Invitation accepted successfully. Account created.',
      data: result,
      token: result.token,
      user: result.user,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred while accepting the invitation.',
    });
  }
};

export const getInvitationDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req.query.token as string) || (req.params.token as string);
    const result = await invitationService.getInvitationByToken(token);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to retrieve invitation details.',
    });
  }
};

export const logoutAll = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication required.',
      });
      return;
    }

    await authService.logoutAll(userId);

    res.status(200).json({
      success: true,
      message: 'Successfully logged out of all devices.',
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'An error occurred while logging out of all devices.',
    });
  }
};

export const setup2FA = async (req: Request, res: Response): Promise<void> => {  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication required.',
      });
      return;
    }

    const result = await totpService.setup(userId);
    res.status(200).json({
      success: true,
      message: 'TOTP 2FA secret and QR code generated successfully.',
      data: result,
      secret: result.secret,
      qrCode: result.qrCode,
      otpauthUrl: result.otpauthUrl,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to setup 2FA.',
    });
  }
};

export const verifyAndEnable2FA = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication required.',
      });
      return;
    }

    const { token } = req.body;
    const result = await totpService.verifyAndEnable({ userId, token });
    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
      isTwoFactorEnabled: result.isTwoFactorEnabled,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to verify and enable 2FA.',
    });
  }
};

export const disable2FA = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication required.',
      });
      return;
    }

    const { password, token } = req.body;
    const result = await totpService.disable({ userId, password, token });
    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
      isTwoFactorEnabled: result.isTwoFactorEnabled,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to disable 2FA.',
    });
  }
};

export const loginVerify2FA = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tempToken, token, email, password } = req.body;
    const result = await totpService.loginVerify({ tempToken, token, email, password });
    res.status(200).json({
      success: true,
      message: 'Two-factor authentication verified successfully. Logged in.',
      data: result,
      token: result.token,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Two-factor verification failed.',
    });
  }
};

export const get2FAStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Authentication required.',
      });
      return;
    }

    const result = await totpService.getStatus(userId);
    res.status(200).json({
      success: true,
      message: 'Two-factor authentication status retrieved successfully.',
      data: result,
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to retrieve 2FA status.',
    });
  }
};
