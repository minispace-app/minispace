import Cookies from "js-cookie";

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: "super_admin" | "admin_garderie" | "educateur" | "parent";
  avatar_url: string | null;
  preferred_locale: string;
  force_password_change?: boolean;
}

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeAuthData(data: {
  access_token: string;
  refresh_token: string;
  user: User;
  garderie_name?: string;
}) {
  Cookies.set("access_token", data.access_token, { expires: 1 / 96 });
  Cookies.set("refresh_token", data.refresh_token, { expires: 30 });
  localStorage.setItem("user", JSON.stringify(data.user));
  if (data.garderie_name) {
    localStorage.setItem("garderie_name", data.garderie_name);
  }
}

export function getGarderieName(): string {
  try {
    return localStorage.getItem("garderie_name") || "";
  } catch {
    return "";
  }
}

export function clearAuthData() {
  Cookies.remove("access_token");
  Cookies.remove("refresh_token");
  localStorage.removeItem("user");
  localStorage.removeItem("garderie_name");
}

export function isAuthenticated(): boolean {
  return !!Cookies.get("access_token");
}

export function isStaff(user: User | null): boolean {
  return (
    user?.role === "admin_garderie" ||
    user?.role === "educateur" ||
    user?.role === "super_admin"
  );
}
