import { securityConfig } from './security-config';

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];
  const min = securityConfig.passwordMinLength;

  if (!password || password.length < min) {
    errors.push(`Password must be at least ${min} characters`);
  }
  if (securityConfig.passwordRequireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (securityConfig.passwordRequireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (securityConfig.passwordRequireDigit && !/\d/.test(password)) {
    errors.push('Password must contain at least one digit');
  }
  if (securityConfig.passwordRequireSpecialChar && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return { valid: errors.length === 0, errors };
}
