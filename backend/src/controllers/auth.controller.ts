import { Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { invitationService } from '../services/invitation.service';
import { totpService } from '../services/totp.service';
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  getRefreshTokenFromRequest,
} from '../utils/cookie.utils';
import { sendError } from '../utils/httpError';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = {
      ...req.body,
      organizationName: req.body.organizationName || req.body.orgName,
      organizationType: req.body.organizationType || req.body.orgType,
    };
    const result = await authService.register(payload);
    // Refresh token travels in an HttpOnly cookie, never in the response body.
    if (result.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken);
    }
    const { refreshToken: _refreshToken, ...data } = result;
    res.status(201).json({
      success: true,
      message: 'User registered successfully. A verification email has been sent.',
      data,
      token: result.token,
      user: result.user,
    });
  } catch (error: any) {
    sendError(res, error, 'An error occurred during registration.');
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
    // Refresh token travels in an HttpOnly cookie, never in the response body.
    if (result.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken);
    }
    const { refreshToken: _refreshToken, ...loginData } = result;
    res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: loginData,
      token: result.token,
      user: result.user,
    });
  } catch (error: any) {
    sendError(res, error, 'An error occurred during login.');
  }
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    // Primary source is the HttpOnly cookie; the body fallback keeps non-browser
    // clients (e.g. tests, mobile apps) working.
    const refreshToken =
      getRefreshTokenFromRequest(req) ?? req.body?.refreshToken ?? req.body?.refresh_token;

    const result = await authService.refresh(refreshToken);

    // Rotate the cookie on every successful refresh.
    if (result.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken);
    }
    const { refreshToken: _refreshToken, ...refreshData } = result;
    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully.',
      data: refreshData,
      token: result.token,
      user: result.user,
    });
  } catch (error: any) {
    // A stale/invalid cookie should not keep being sent by the browser.
    clearRefreshTokenCookie(res);
    sendError(res, error, 'An error occurred while refreshing the token.');
  }
};

export const logout = async (_req: Request, res: Response): Promise<void> => {
  try {
    clearRefreshTokenCookie(res);
    res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (error: any) {
    sendError(res, error, 'An error occurred while logging out.');
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
    sendError(res, error, 'Email verification failed.');
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
    sendError(res, error, 'Failed to resend verification email.');
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
    sendError(res, error, 'An error occurred during password reset request.');
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
    sendError(res, error, 'An error occurred during password reset.');
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
    sendError(res, error, 'An error occurred during password change.');
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
    sendError(res, error, 'Failed to retrieve user profile.');
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
    sendError(res, error, 'An error occurred while accepting the invitation.');
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
    sendError(res, error, 'Failed to retrieve invitation details.');
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

    clearRefreshTokenCookie(res);

    res.status(200).json({
      success: true,
      message: 'Successfully logged out of all devices.',
    });
  } catch (error: any) {
    sendError(res, error, 'An error occurred while logging out of all devices.');
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
    sendError(res, error, 'Failed to setup 2FA.');
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
    sendError(res, error, 'Failed to verify and enable 2FA.');
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
    sendError(res, error, 'Failed to disable 2FA.');
  }
};

export const loginVerify2FA = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tempToken, token, email, password } = req.body;
    const result = await totpService.loginVerify({ tempToken, token, email, password });
    if (result.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken);
    }
    const { refreshToken: _refreshToken, ...twoFactorData } = result;
    res.status(200).json({
      success: true,
      message: 'Two-factor authentication verified successfully. Logged in.',
      data: twoFactorData,
      token: result.token,
      user: result.user,
    });
  } catch (error: any) {
    sendError(res, error, 'Two-factor verification failed.');
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
    sendError(res, error, 'Failed to retrieve 2FA status.');
  }
};
