// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { helloLine, isNamedPipe, mcpSocketPath, parseHello, SUN_PATH_MAX, userDataDir } from './mcpSocket';

describe('mcpSocketPath', () => {
  it('Linux: <XDG_CONFIG_HOME or ~/.config>/Vitals/mcp.sock', () => {
    expect(mcpSocketPath({ platform: 'linux', env: {}, home: '/home/ann', userName: 'ann' })).toBe('/home/ann/.config/Vitals/mcp.sock');
    expect(mcpSocketPath({ platform: 'linux', env: { XDG_CONFIG_HOME: '/cfg' }, home: '/home/ann', userName: 'ann' })).toBe('/cfg/Vitals/mcp.sock');
    // a relative XDG_CONFIG_HOME is ignored, as the XDG spec says
    expect(mcpSocketPath({ platform: 'linux', env: { XDG_CONFIG_HOME: 'cfg' }, home: '/home/ann', userName: 'ann' })).toBe('/home/ann/.config/Vitals/mcp.sock');
  });

  it('macOS: ~/Library/Application Support/Vitals/mcp.sock', () => {
    expect(mcpSocketPath({ platform: 'darwin', env: {}, home: '/Users/ann', userName: 'ann' })).toBe('/Users/ann/Library/Application Support/Vitals/mcp.sock');
  });

  it('Windows: a named pipe with the user name', () => {
    const p = mcpSocketPath({ platform: 'win32', env: {}, home: 'C:\\Users\\ann', userName: 'ann smith' });
    expect(p).toBe('\\\\.\\pipe\\vitals-mcp-ann_smith');
    expect(isNamedPipe(p)).toBe(true);
    expect(isNamedPipe('/tmp/x.sock')).toBe(false);
    expect(userDataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\ann\\AppData\\Roaming' }, home: 'C:\\Users\\ann' })).toBe('C:\\Users\\ann\\AppData\\Roaming\\Vitals');
  });

  it('falls back to a short path under XDG_RUNTIME_DIR, then tmp, when userData is too long for sun_path', () => {
    const home = `/home/${'a'.repeat(120)}`;
    expect(mcpSocketPath({ platform: 'linux', env: { XDG_RUNTIME_DIR: '/run/user/1000' }, home, userName: 'ann' })).toBe('/run/user/1000/vitals-mcp-ann.sock');
    expect(mcpSocketPath({ platform: 'linux', env: { TMPDIR: '/var/tmp' }, home, userName: 'ann' })).toBe('/var/tmp/vitals-mcp-ann.sock');
    expect(mcpSocketPath({ platform: 'darwin', env: {}, home, userName: 'ann' })).toBe('/tmp/vitals-mcp-ann.sock');
    const edge = mcpSocketPath({ platform: 'linux', env: {}, home: `/home/${'b'.repeat(SUN_PATH_MAX.linux! - '/home/'.length - '/.config/Vitals/mcp.sock'.length)}`, userName: 'x' });
    expect(Buffer.byteLength(edge)).toBe(SUN_PATH_MAX.linux);
    expect(edge.endsWith('/.config/Vitals/mcp.sock')).toBe(true);
  });
});

describe('hello line', () => {
  it('round-trips the client id and rejects anything else', () => {
    expect(helloLine('claude-code')).toBe('{"client":"claude-code"}\n');
    expect(parseHello('{"client":"claude-code"}')).toEqual({ client: 'claude-code' });
    expect(parseHello(helloLine(null).trim())).toEqual({ client: null });
    expect(parseHello('{"client":"bad id!"}')).toEqual({ client: null });
    expect(parseHello('{"jsonrpc":"2.0","id":1,"method":"initialize"}')).toBeNull();
    expect(parseHello('not json')).toBeNull();
  });
});
