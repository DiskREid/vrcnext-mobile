import { describe, expect, it, vi } from 'vitest';
import { createApi } from './index';
import type { NativeBridge, NativeResponse } from './native';

function client(response: NativeResponse = { status: 200, data: {} }) {
  const request = vi.fn(async () => response);
  return { api: createApi({ request } as unknown as NativeBridge), request };
}

describe('distinct VRChat invitation operations', () => {
  it('uses the documented self route and preserves the full group, region and nonce', async () => {
    const { api, request } = client();
    const location = 'wrld_target:220~group(grp_target)~groupAccessType(members)~region(eu)~nonce(opaque+nonce)';
    await api.inviteSelf(location);
    expect(request).toHaveBeenCalledExactlyOnceWith({ path: '/invite/myself/to/' + location.replace('+', '%2B'), method: 'POST', body: '{}' });
  });
  it('does not disguise an inaccessible target or server failure as success or retry another target', async () => {
    for (const status of [401, 403, 404, 429]) {
      const { api, request } = client({ status, data: {} });
      await expect(api.inviteSelf('wrld_target:220~region(eu)')).rejects.toMatchObject({ status });
      expect(request).toHaveBeenCalledOnce();
    }
    const { api, request } = client();
    for (const location of ['offline', 'private', 'traveling', 'wrld_target:private', 'wrld_target:1/../auth'])
      expect(() => api.inviteSelf(location)).toThrow('Нет доступного инстанса');
    expect(request).not.toHaveBeenCalled();
  });
  it('requests an invite from the selected friend with requestSlot, independently of location', async () => {
    const { api, request } = client();
    await api.requestInvite('usr_friend');
    await api.requestInvite('usr_friend', 3);
    expect(request.mock.calls).toEqual([
      [{ path: '/requestInvite/usr_friend', method: 'POST', body: '{}' }],
      [{ path: '/requestInvite/usr_friend', method: 'POST', body: '{"requestSlot":3}' }],
    ]);
  });
  it('invites the specified recipient into the selected full instance without a self-invite', async () => {
    const { api, request } = client();
    await api.invite('usr_recipient', 'wrld_target:22~hidden(usr_owner)~region(jp)~nonce(secret)', 2);
    expect(request).toHaveBeenCalledExactlyOnceWith({ path: '/invite/usr_recipient', method: 'POST', body: '{"instanceId":"wrld_target:22~hidden(usr_owner)~region(jp)~nonce(secret)","messageSlot":2}' });
  });
});
