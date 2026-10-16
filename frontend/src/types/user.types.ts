/**
 * User and Organization Types derived from OpenAPI 3.0 Specification
 */

export type OrganizationType = 'CARRIER' | 'WAREHOUSE_OPERATOR';

export type UserRole =
  | 'WAREHOUSE_ADMIN'
  | 'DOCK_MANAGER'
  | 'CARRIER_ADMIN'
  | 'DISPATCHER';

export interface Organization {
  id: number;
  name: string;
  type: OrganizationType;
  createdAt?: string;
  updatedAt?: string;
}

export interface User {
  id: number;
  email: string;
  role: UserRole;
  organizationId: number;
  isActive?: boolean;
  isEmailVerified: boolean;
  isTwoFactorEnabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  organization?: Organization;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  organizationName?: string;
  orgName?: string;
  organizationType: OrganizationType;
  orgType?: OrganizationType;
}

export interface AuthResponse {
  success?: boolean;
  message?: string;
  token?: string;
  refreshToken?: string;
  requires2FA?: boolean;
  tempToken?: string;
  user?: User;
  data?: {
    token?: string;
    refreshToken?: string;
    requires2FA?: boolean;
    tempToken?: string;
    user: User;
  };
}

/* ------------------------------------------------------------------ *
 * Two-Factor Authentication (TOTP)
 * ------------------------------------------------------------------ */

export interface TwoFactorStatus {
  isTwoFactorEnabled: boolean;
  /** True when a secret was generated but never confirmed with a valid code. */
  isSetupPending: boolean;
}

export interface TwoFactorSetupResponse {
  secret: string;
  /** PNG data URL suitable for an <img src="..."> tag. */
  qrCode: string;
  otpauthUrl: string;
}

export interface TwoFactorVerifyRequest {
  token: string;
}

export interface TwoFactorDisableRequest {
  password?: string;
  token?: string;
}

export interface TwoFactorLoginVerifyRequest {
  token: string;
  tempToken?: string;
  email?: string;
  password?: string;
}
