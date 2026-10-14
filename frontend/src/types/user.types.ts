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
  isEmailVerified: boolean;
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
  user?: User;
  data?: {
    token: string;
    user: User;
  };
}
