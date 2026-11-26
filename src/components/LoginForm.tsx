import { useState, type FormEvent } from 'react'

export function LoginForm({
  onLogin
}: {
  onLogin: (password: string) => Promise<void>
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
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
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <h1>superlight-notion</h1>
        <p>笔记仍在 Notion 里，这里只做轻量阅读和编辑。</p>
        <label>
          访问密码
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <button type="submit" disabled={busy || !password}>
          {busy ? '登录中…' : '进入'}
        </button>
      </form>
    </div>
  )
}
