export default function Toast({ msg, type, visible }) {
  const cls = `toast${visible ? ' show' : ''}${type === 'err' ? ' err' : type === 'info' ? ' info' : ''}`
  return <div className={cls}>{msg}</div>
}
