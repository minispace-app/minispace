"use client";

const COLORS = [
  "bg-blue-500",
  "bg-purple-500",
  "bg-emerald-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-rose-500",
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
}

const SIZE = {
  sm: "w-7 h-7 text-[10px]",
  md: "w-9 h-9 text-xs",
  lg: "w-11 h-11 text-sm",
};

export function ChildAvatar({ id, firstName, lastName, size = "md" }: Props) {
  return (
    <div
      className={`${SIZE[size]} ${childAvatarColor(id)} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}
    >
      {firstName[0]}{lastName[0]}
    </div>
  );
}
