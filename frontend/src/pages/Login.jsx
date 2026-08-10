import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { apiErrorMessages } from '../api/client.js';
import Logo from '../components/Logo.jsx';
import { Button } from '../components/ui.jsx';
import { useAuth } from '../context/auth.jsx';

function AuthField({ id, label, type = 'text', value, onChange, placeholder, autoComplete }) {
  return (
    <label className="auth-field" htmlFor={id}>
      <span className="auth-field-label">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
      />
    </label>
  );
}

export default function Login() {
  const { status, user, registrationOpen, login, register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === 'loading') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <Logo size={34} />
            <span>open·kritt</span>
          </div>
          <div className="auth-status">Checking…</div>
        </div>
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    if (registrationOpen && confirm !== password) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await (registrationOpen ? register(username, password) : login(username, password));
      navigate('/', { replace: true });
    } catch (requestError) {
      setError(apiErrorMessages(requestError)[0]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-logo">
          <Logo size={34} />
          <span>open·kritt</span>
        </div>
        <div className="auth-heading">{registrationOpen ? 'Create the admin account' : 'Sign in'}</div>
        <div className="auth-subheading">
          {registrationOpen
            ? 'This is a fresh install — the first account is the administrator. Sign-up closes after it is created.'
            : 'Enter your credentials to continue.'}
        </div>
        <AuthField
          id="auth-username"
          label="Username"
          value={username}
          onChange={setUsername}
          placeholder="admin"
          autoComplete="username"
        />
        <AuthField
          id="auth-password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          autoComplete={registrationOpen ? 'new-password' : 'current-password'}
        />
        {registrationOpen && (
          <AuthField
            id="auth-confirm"
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        )}
        {error && <div className="auth-error">{error}</div>}
        <Button type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
          {busy ? 'Working…' : registrationOpen ? 'Create admin account' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
