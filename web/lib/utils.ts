import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncate(value: string, length: number) {
  if (value.length <= length) return value;
  return `${value.slice(0, Math.max(0, length - 1)).trimEnd()}…`;
}

export function getTitleFromPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return "Untitled research session";
  return truncate(normalized, 48);
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export async function readFileText(file: File) {
  if (!["text/plain", "text/markdown", ""].includes(file.type) && !/\.(txt|md)$/i.test(file.name)) {
    throw new Error("Only .txt and .md files are currently parsed in the MVP.");
  }

  return file.text();
}
