// 09-settings 模块 API —— 工作区设置 / IAM（成员·角色·团队·邀请·API令牌·审计）。
// 独立文件，避免与 client.ts 并发冲突；复用同一 axios 实例（baseURL /api）。
// 对应后端 services/sql-engine/settings_api.py（路径 /tenants/* 与 /iam/*）。
import { http } from "./client";

// ── 类型 ────────────────────────────────────────────────────────────────────

export interface Workspace {
  id: number;
  name: string;
  slug: string;
  region: string;
  plan: string;
  created_at: string;
  tier: string;
  kafka_topic: string | null;
}

export interface WorkspaceUpdate {
  name?: string;
  region?: string;
  plan?: string;
}

export interface IamUser {
  id: number;
  email: string;
  name: string | null;
  status: string; // active / inactive / pending
  created_at: string;
  role: string | null;
  teams: string[];
}

export interface Role {
  id: number;
  name: string;
  scope: Record<string, any>;
  member_count: number;
}

export interface Team {
  id: number;
  name: string;
  description: string | null;
  member_count: number;
}

export interface Invitation {
  id: number;
  email: string;
  role: string | null;
  status: string;
  expires_at: string;
  invited_by: string | null;
}

export interface ApiToken {
  id: number;
  label: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used: string | null;
  revoked_at: string | null;
}

export interface AuditEntry {
  id: number;
  time: string;
  actor: string;
  action: string;
  target: string;
  module: string;
  details: Record<string, any> | null;
}

export interface Paged<T> {
  total: number;
  data: T[];
}

// ── 工作区 tenants ────────────────────────────────────────────────────────────

export async function getWorkspace(tenantId: number): Promise<Workspace> {
  const { data } = await http.get(`/tenants/${tenantId}`);
  return data;
}

export async function updateWorkspace(
  tenantId: number,
  body: WorkspaceUpdate,
  actor = "system",
): Promise<Workspace & { updated_at: string }> {
  const { data } = await http.patch(`/tenants/${tenantId}`, body, { params: { actor } });
  return data;
}

// ── 成员 users ────────────────────────────────────────────────────────────────

export interface ListUsersParams {
  tenant_id: number;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listUsers(params: ListUsersParams): Promise<Paged<IamUser>> {
  const { data } = await http.get(`/iam/users`, { params });
  return data;
}

export interface UserCreateBody {
  tenant_id: number;
  email: string;
  name?: string | null;
  role_id?: number | null;
}

export async function createUser(body: UserCreateBody): Promise<{
  id: number; email: string; name: string | null; status: string;
}> {
  const { data } = await http.post(`/iam/users`, body);
  return data;
}

export interface UserUpdateBody {
  name?: string;
  status?: "active" | "inactive" | "pending";
}

export async function updateUser(
  userId: number,
  body: UserUpdateBody,
  tenantId?: number,
): Promise<IamUser> {
  const { data } = await http.patch(`/iam/users/${userId}`, body, {
    params: tenantId != null ? { tenant_id: tenantId } : undefined,
  });
  return data;
}

export async function deleteUser(userId: number, tenantId?: number): Promise<{ ok: boolean }> {
  const { data } = await http.delete(`/iam/users/${userId}`, {
    params: tenantId != null ? { tenant_id: tenantId } : undefined,
  });
  return data;
}

// ── 角色 roles ──────────────────────────────────────────────────────────────

export async function listRoles(tenantId: number): Promise<Role[]> {
  const { data } = await http.get(`/iam/roles`, { params: { tenant_id: tenantId } });
  return data.data;
}

export interface RoleCreateBody {
  tenant_id: number;
  name: string;
  scope?: Record<string, any>;
}

export async function createRole(body: RoleCreateBody): Promise<Role> {
  const { data } = await http.post(`/iam/roles`, { scope: {}, ...body });
  return data;
}

export interface RoleUpdateBody {
  name?: string;
  scope?: Record<string, any>;
}

export async function updateRole(
  roleId: number,
  body: RoleUpdateBody,
  tenantId?: number,
): Promise<Role> {
  const { data } = await http.patch(`/iam/roles/${roleId}`, body, {
    params: tenantId != null ? { tenant_id: tenantId } : undefined,
  });
  return data;
}

export async function deleteRole(roleId: number, tenantId?: number): Promise<{ ok: boolean }> {
  const { data } = await http.delete(`/iam/roles/${roleId}`, {
    params: tenantId != null ? { tenant_id: tenantId } : undefined,
  });
  return data;
}

// ── 团队 teams ────────────────────────────────────────────────────────────────

export async function listTeams(tenantId: number): Promise<Team[]> {
  const { data } = await http.get(`/iam/teams`, { params: { tenant_id: tenantId } });
  return data.data;
}

export interface TeamCreateBody {
  tenant_id: number;
  name: string;
  description?: string | null;
}

export async function createTeam(body: TeamCreateBody): Promise<Team> {
  const { data } = await http.post(`/iam/teams`, body);
  return data;
}

export async function addTeamMember(teamId: number, userId: number): Promise<{ ok: boolean }> {
  const { data } = await http.post(`/iam/teams/${teamId}/members`, { user_id: userId });
  return data;
}

export async function removeTeamMember(teamId: number, userId: number): Promise<{ ok: boolean }> {
  const { data } = await http.delete(`/iam/teams/${teamId}/members/${userId}`);
  return data;
}

// ── 邀请 invitations ──────────────────────────────────────────────────────────

export interface InvitationCreateBody {
  tenant_id: number;
  email: string;
  role_id: number;
  teams?: number[];
  invited_by?: number | null;
}

export async function createInvitation(body: InvitationCreateBody): Promise<{
  id: number; token: string; email: string; expires_at: string; invitation_url: string;
}> {
  const { data } = await http.post(`/iam/invitations`, body);
  return data;
}

export async function listInvitations(tenantId: number, status?: string): Promise<Invitation[]> {
  const { data } = await http.get(`/iam/invitations`, {
    params: { tenant_id: tenantId, status },
  });
  return data.data;
}

export async function acceptInvitation(
  token: string,
  body: { password?: string; name?: string } = {},
): Promise<{ user_id: number; status: string }> {
  const { data } = await http.post(`/iam/invitations/${token}/accept`, body);
  return data;
}

export async function cancelInvitation(
  invitationId: number,
  tenantId?: number,
): Promise<{ ok: boolean }> {
  const { data } = await http.delete(`/iam/invitations/${invitationId}`, {
    params: tenantId != null ? { tenant_id: tenantId } : undefined,
  });
  return data;
}

// ── API 令牌 tokens ───────────────────────────────────────────────────────────

export interface ListTokensParams {
  tenant_id: number;
  limit?: number;
  offset?: number;
}

export async function listTokens(params: ListTokensParams): Promise<Paged<ApiToken>> {
  const { data } = await http.get(`/iam/tokens`, { params });
  return data;
}

export interface TokenCreateBody {
  tenant_id: number;
  label: string;
  scopes?: string[];
  created_by?: number | null;
}

export async function issueToken(body: TokenCreateBody): Promise<{
  id: number; label: string; token_plaintext: string; prefix: string; created_at: string;
}> {
  const { data } = await http.post(`/iam/tokens`, { scopes: [], ...body });
  return data;
}

export async function revokeToken(
  tokenId: number,
  tenantId?: number,
): Promise<{ ok: boolean; revoked_at: string }> {
  const { data } = await http.delete(`/iam/tokens/${tokenId}`, {
    params: tenantId != null ? { tenant_id: tenantId } : undefined,
  });
  return data;
}

// ── 审计 audit ────────────────────────────────────────────────────────────────

export interface ListAuditParams {
  tenant_id: number;
  actor?: string;
  action?: string;
  target?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function listAudit(params: ListAuditParams): Promise<Paged<AuditEntry>> {
  const { data } = await http.get(`/iam/audit`, { params });
  return data;
}
