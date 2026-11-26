import { sessionCookie } from '../_lib/auth'
import { json, type Env } from '../_lib/env'

export const onRequestPost: PagesFunction<Env> = async () => {
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', true) })
}
