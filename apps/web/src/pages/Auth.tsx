import { AuthForm } from '../components/AuthForm';

export function SignupPage() {
  return <AuthForm mode="signup" />;
}
export function LoginPage() {
  return <AuthForm mode="login" />;
}
