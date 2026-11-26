import { useState, type FormEvent } from 'react'

export function LoginForm({
  oauthEnabled,
  passwordEnabled,
  errorMessage,
  onLogin
}: {
  oauthEnabled: boolean
  passwordEnabled: boolean
  errorMessage?: string | null
  onLogin: (password: string) => Promise<void>
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(errorMessage ?? null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onLogin(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <h1>superlight-notion</h1>
        <p>笔记仍在 Notion 里，这里只做轻量阅读和编辑。</p>
        {error ? <div className="form-error">{error}</div> : null}
        {oauthEnabled ? (
          <a className="oauth-button" href="/api/oauth/start">
            用 Notion 登录
          </a>
        ) : null}
        {oauthEnabled && passwordEnabled ? <div className="login-or">或</div> : null}
        {passwordEnabled ? (
          <form onSubmit={(e) => void submit(e)}>
            <label>
              访问密码
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy || !password}>
              {busy ? '登录中…' : '进入'}
            </button>
          </form>
        ) : null}
        {!oauthEnabled && !passwordEnabled ? (
          <p className="muted">还没有配置 Notion OAuth 或开发回退登录。</p>
        ) : null}
      </div>
    </div>
  )
}
