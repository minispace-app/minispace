"use client";

const COLORS = [
  "bg-primary",
  "bg-accent-green",
  "bg-accent-blue",
  "bg-accent-purple",
  "bg-accent-orange",
  "bg-accent-yellow",
  "bg-status-danger",
  "bg-status-success",
];

export function childAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffff;
  return COLORS[hash % COLORS.length];
}

interface Props {
  id: string;
  firstName: string;
  lastName: string;
  size?: "sm" | "md" | "lg";
  photoUrl?: string | null;
}

const SIZE = {
  sm: "w-7 h-7 text-[10px]",
  md: "w-9 h-9 text-caption",
  lg: "w-11 h-11 text-body",
};

export function ChildAvatar({ id, firstName, lastName, size = "md", photoUrl }: Props) {
  if (photoUrl) {
    return (
      <div className={`${SIZE[size]} rounded-pill overflow-hidden flex-shrink-0`}>
        <img src={photoUrl} className="w-full h-full object-cover" alt="" />
      </div>
    );
  }

  return (
    <div
      className={`${SIZE[size]} ${childAvatarColor(id)} rounded-pill flex items-center justify-center text-white font-bold flex-shrink-0`}
    >
      {firstName[0]}{lastName[0]}
    </div>
  );
}
