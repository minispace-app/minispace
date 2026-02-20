import axios from "axios";
import Cookies from "js-cookie";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost/api";

function getTenantSlug(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.hostname.split(".");
  return parts.length >= 2 ? parts[0] : "";
}

// Super-admin axios instance — sends X-Super-Admin-Key, no tenant/JWT headers
export const superAdminClient = axios.create({ baseURL: API_URL });
superAdminClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const key = localStorage.getItem("super_admin_key") || "";
    config.headers["X-Super-Admin-Key"] = key;
  }
  return config;
});

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

// Attach auth token and tenant header
apiClient.interceptors.request.use((config) => {
  const token = Cookies.get("access_token");
  const tenant = getTenantSlug();

  if (token) config.headers["Authorization"] = `Bearer ${token}`;
  if (tenant) config.headers["X-Tenant"] = tenant;

  return config;
});

// Auto-refresh on 401
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = Cookies.get("refresh_token");
        const tenant = getTenantSlug();
        const res = await axios.post(
          `${API_URL}/auth/refresh`,
          { refresh_token: refreshToken },
          { headers: { "X-Tenant": tenant } }
        );
        const { access_token, refresh_token } = res.data;
        Cookies.set("access_token", access_token, { expires: 1 / 96 }); // 15 min
        Cookies.set("refresh_token", refresh_token, { expires: 30 });
        original.headers["Authorization"] = `Bearer ${access_token}`;
        return apiClient(original);
      } catch {
        Cookies.remove("access_token");
        Cookies.remove("refresh_token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

// Auth endpoints
export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post("/auth/login", { email, password }, {
      headers: { "X-Tenant": getTenantSlug() },
    }),
  logout: (refreshToken: string) =>
    apiClient.post("/auth/logout", { refresh_token: refreshToken }),
  me: () => apiClient.get("/auth/me"),
  invite: (email: string, role: string) =>
    apiClient.post("/auth/invite", { email, role }, {
      headers: { "X-Tenant": getTenantSlug() },
    }),
  listPendingInvitations: () =>
    apiClient.get("/auth/invitations"),
  deleteInvitation: (id: string) =>
    apiClient.delete(`/auth/invitations/${id}`),
  register: (data: {
    token: string;
    first_name: string;
    last_name: string;
    password: string;
    preferred_locale?: string;
  }) => apiClient.post("/auth/register", data),
  registerPushToken: (platform: string, token: string) =>
    apiClient.post("/auth/push-token", { platform, token }),
  changePassword: (current_password: string, new_password: string) =>
    apiClient.post("/auth/change-password", { current_password, new_password }),
  updateEmail: (new_email: string, password: string) =>
    apiClient.post("/auth/update-email", { new_email, password }),
  forgotPassword: (email: string) =>
    apiClient.post("/auth/forgot-password", { email }, {
      headers: { "X-Tenant": getTenantSlug() },
    }),
  resetPassword: (token: string, new_password: string) =>
    apiClient.post("/auth/reset-password", { token, new_password }, {
      headers: { "X-Tenant": getTenantSlug() },
    }),
  verify2fa: (email: string, code: string) =>
    apiClient.post("/auth/verify-2fa", { email, code }, {
      headers: { "X-Tenant": getTenantSlug() },
    }),
};

// Messages
export const messagesApi = {
  list: (page = 1, perPage = 20) =>
    apiClient.get("/messages", { params: { page, per_page: perPage } }),
  send: (data: {
    message_type: string;
    content: string;
    group_id?: string;
    recipient_id?: string;
  }) => apiClient.post("/messages", data),
  sendToParents: (data: {
    subject: string;
    content: string;
    scope: "all_parents" | "child_parents" | "group_parents";
    child_id?: string;
    group_id?: string;
  }) => apiClient.post("/messages/send-to-parents", data),
  markRead: (id: string) => apiClient.post(`/messages/${id}/read`),
  conversation: (userId: string, page = 1) =>
    apiClient.get(`/messages/conversation/${userId}`, {
      params: { page },
    }),
  getConversations: () => apiClient.get("/messages/conversations"),
  getBroadcastThread: (page = 1, perPage = 100) =>
    apiClient.get("/messages/thread/broadcast", { params: { page, per_page: perPage } }),
  getGroupThread: (groupId: string, page = 1, perPage = 100) =>
    apiClient.get(`/messages/thread/group/${groupId}`, { params: { page, per_page: perPage } }),
  getIndividualThread: (parentId: string, page = 1, perPage = 100) =>
    apiClient.get(`/messages/thread/individual/${parentId}`, { params: { page, per_page: perPage } }),
  markThreadRead: (kind: string, id?: string | null) =>
    apiClient.post("/messages/thread/mark-read", { kind, id: id ?? null }),
};

// Media
export const mediaApi = {
  list: (params?: { group_id?: string; child_ids?: string; page?: number; period?: string; date?: string }) =>
    apiClient.get("/media", { params }),
  upload: (formData: FormData) =>
    apiClient.post("/media", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  update: (id: string, data: { caption?: string; visibility: string; group_id?: string; child_ids?: string[] }) =>
    apiClient.put(`/media/${id}`, data),
  delete: (id: string) => apiClient.delete(`/media/${id}`),
  bulk: (data: { action: string; media_ids: string[]; visibility?: string; group_id?: string; child_ids?: string[] }) =>
    apiClient.post("/media/bulk", data),
};

// Documents
export const documentsApi = {
  list: (params?: { category?: string; group_id?: string; page?: number }) =>
    apiClient.get("/documents", { params }),
  upload: (formData: FormData) =>
    apiClient.post("/documents", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  update: (id: string, data: { title: string; category: string; visibility: string; group_id?: string; child_id?: string }) =>
    apiClient.put(`/documents/${id}`, data),
  delete: (id: string) => apiClient.delete(`/documents/${id}`),
};

// Groups
export const groupsApi = {
  list: () => apiClient.get("/groups"),
  setChildren: (id: string, child_ids: string[]) =>
    apiClient.put(`/groups/${id}/children`, { child_ids }),
  create: (data: { name: string; description?: string; color?: string }) =>
    apiClient.post("/groups", data),
  update: (id: string, data: Partial<{ name: string; description: string; color: string }>) =>
    apiClient.put(`/groups/${id}`, data),
  delete: (id: string) => apiClient.delete(`/groups/${id}`),
};

// Children
export const childrenApi = {
  list: () => apiClient.get("/children"),
  create: (data: {
    first_name: string;
    last_name: string;
    birth_date: string;
    group_id?: string;
    notes?: string;
  }) => apiClient.post("/children", data),
  update: (id: string, data: Partial<{ first_name: string; last_name: string; birth_date: string; group_id: string | null; is_active: boolean }>) =>
    apiClient.put(`/children/${id}`, data),
  listParents: (childId: string) => apiClient.get(`/children/${childId}/parents`),
  assignParent: (childId: string, userId: string, relationship: string) =>
    apiClient.post(`/children/${childId}/parents`, { user_id: userId, relationship }),
  removeParent: (childId: string, userId: string) =>
    apiClient.delete(`/children/${childId}/parents/${userId}`),
  delete: (childId: string) => apiClient.delete(`/children/${childId}`),
};

// Tenant user management (admin_garderie)
export const usersApi = {
  list: () => apiClient.get("/users"),
  create: (data: { email: string; first_name: string; last_name: string; password: string; role?: string; preferred_locale?: string }) =>
    apiClient.post("/users", data),
  update: (id: string, data: { first_name?: string; last_name?: string; role?: string; is_active?: boolean; preferred_locale?: string }) =>
    apiClient.put(`/users/${id}`, data),
  deactivate: (id: string, password?: string, hard?: boolean) =>
    apiClient.delete(`/users/${id}`, { params: { hard }, data: { password } }),
  resetPassword: (id: string, method: "email" | "temp_password" = "email") =>
    apiClient.post(`/users/${id}/reset-password`, { method }),
};

// Journal de bord
export const journalApi = {
  getWeek: (childId: string, weekStart: string) =>
    apiClient.get("/journals", { params: { child_id: childId, week_start: weekStart } }),
  upsert: (data: {
    child_id: string;
    date: string;
    temperature?: string | null;
    menu?: string | null;
    appetit?: string | null;
    humeur?: string | null;
    sommeil_minutes?: number | null;
    sante?: string | null;
    medicaments?: string | null;
    message_educatrice?: string | null;
    observations?: string | null;
  }) => apiClient.put("/journals", data),
  sendToParents: (childId: string, weekStart: string) =>
    apiClient.post(`/journals/${childId}/send-to-parents`, { week_start: weekStart }),
  sendAllToParents: (weekStart: string) =>
    apiClient.post("/journals/send-all-to-parents", { week_start: weekStart }),
};

// Email (admin/educateur → parents)
export const emailApi = {
  sendToParents: (data: { subject: string; body: string; recipient_id?: string }) =>
    apiClient.post("/email/send-to-parents", data),
};

// Super-admin management
export const superAdminApi = {
  listGarderies: () => superAdminClient.get("/super-admin/garderies"),
  createGarderie: (data: { slug: string; name: string; address?: string; phone?: string; email?: string; plan?: string }) =>
    superAdminClient.post("/super-admin/garderies", data),
  updateGarderie: (slug: string, data: { name?: string; address?: string; phone?: string; email?: string; is_active?: boolean }) =>
    superAdminClient.put(`/super-admin/garderies/${slug}`, data),
  listGarderieUsers: (slug: string) =>
    superAdminClient.get(`/super-admin/garderies/${slug}/users`),
  createGarderieUser: (slug: string, data: { email: string; first_name: string; last_name: string; password: string; role?: string; preferred_locale?: string }) =>
    superAdminClient.post(`/super-admin/garderies/${slug}/users`, data),
  deactivateGarderieUser: (slug: string, userId: string) =>
    superAdminClient.delete(`/super-admin/garderies/${slug}/users/${userId}`),
  deleteGarderie: (slug: string) =>
    superAdminClient.delete(`/super-admin/garderies/${slug}`),
  inviteGarderieUser: (slug: string, email: string, role: string) =>
    superAdminClient.post(`/super-admin/garderies/${slug}/invite`, { email, role }),
  triggerBackupAll: () =>
    superAdminClient.post(`/super-admin/backup`),
  listBackups: () =>
    superAdminClient.get(`/super-admin/backups`),
  triggerRestore: (db_file: string, media_file?: string) =>
    superAdminClient.post(`/super-admin/restore`, { db_file, media_file }),
};

export const userApi = {
  listUsers: () => apiClient.get("/users"),
  createUser: (data: { email: string; first_name: string; last_name: string; password: string; role?: string; preferred_locale?: string }) =>
    apiClient.post("/users", data),
  updateUser: (userId: string, data: { first_name?: string; last_name?: string; role?: string; is_active?: boolean; preferred_locale?: string }) =>
    apiClient.put(`/users/${userId}`, data),
  deactivateUser: (userId: string) =>
    apiClient.delete(`/users/${userId}`),
  resetUserPassword: (userId: string, method: "email" | "temp_password" = "email") =>
    apiClient.post(`/users/${userId}/reset-password`, { method }),
};

