import { describe, expect, it } from 'vitest';
import { canCreateGroupInstance, createdInstanceLocation, groupCreationPermissions, instanceCreationOptions } from './instances';
import type { CreateInstanceOptions, Group } from './types';
const base: CreateInstanceOptions={worldId:'wrld_world',type:'group',region:'eu',ownerId:'grp_group',groupAccessType:'members'};
describe('real group creation contract', () => {
  it('sends real owner/group access and the supported minimum performance restriction', () => {
    expect(instanceCreationOptions({...base,minimumAvatarPerformance:'Good',displayName:' Mobile ',queueEnabled:true,roleIds:['grol_member','grol_member']})).toEqual({...base,minimumAvatarPerformance:'Good',displayName:'Mobile',queueEnabled:true,roleIds:['grol_member']});
    expect(instanceCreationOptions(base)).not.toHaveProperty('minimumAvatarPerformance');
  });
  it('rejects wrong group IDs and invalid performance/role combinations before a POST', () => {
    expect(()=>instanceCreationOptions({...base,ownerId:'grpm_membership'})).toThrow('владельца');
    expect(()=>instanceCreationOptions({...base,minimumAvatarPerformance:'VeryPoor' as 'Good'})).toThrow('аватара');
    expect(()=>instanceCreationOptions({...base,groupAccessType:'public',roleIds:['grol_member']})).toThrow('роли');
    expect(instanceCreationOptions({worldId:'wrld_world',type:'public',region:'eu',ownerId:'grp_old',minimumAvatarPerformance:'Good'})).toEqual({worldId:'wrld_world',type:'public',region:'eu'});
  });
  it('uses the full instanceId instead of an abbreviated id from a successful creation', () => {
    expect(createdInstanceLocation({id:'123',instanceId:'123~group(grp_group)~groupAccessType(members)~region(eu)',worldId:'wrld_world'},'wrld_world')).toBe('wrld_world:123~group(grp_group)~groupAccessType(members)~region(eu)');
    expect(createdInstanceLocation({instanceId:'123',id:'123~group(grp_group)~region(eu)'},'wrld_world')).toBe('wrld_world:123~group(grp_group)~region(eu)');
    expect(()=>createdInstanceLocation({instanceId:'123~group(grp_a)',id:'123~group(grp_b)'},'wrld_world')).toThrow('полный адрес');
    expect(()=>createdInstanceLocation({location:'private',instanceId:'123'},'wrld_world')).toThrow('полный адрес');
    expect(()=>createdInstanceLocation({location:'wrld_other:123'},'wrld_world')).toThrow('полный адрес');
  });
  it('uses actual current membership permissions, roles and owner authority', () => {
    const group:Group={id:'grp_group',name:'Group',myMember:{permissions:['group_instance_public_create']}};
    expect(canCreateGroupInstance(groupCreationPermissions(group,'usr_me'),'public')).toBe(true);
    expect(canCreateGroupInstance(groupCreationPermissions(group,'usr_me'),'members')).toBe(false);
    expect(canCreateGroupInstance(groupCreationPermissions({...group,ownerId:'usr_me'},'usr_me'),'members')).toBe(true);
    expect(groupCreationPermissions({id:group.id,name:group.name},'usr_me')).toBeUndefined();
    const roles:Group={id:group.id,name:group.name,myMember:{roleIds:['grol_host']},roles:[{id:'grol_host',name:'Host',permissions:['group-instance-plus-create']}]};
    expect(canCreateGroupInstance(groupCreationPermissions(roles,'usr_me'),'plus')).toBe(true);
    expect(canCreateGroupInstance(new Set([]),'members',true)).toBe(false);
  });
});
