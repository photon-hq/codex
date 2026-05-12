import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function publicUrl(path = "/") {
  const base = process.env.PUBLIC_URL ?? "http://localhost:3000";
  return new URL(path, base).toString();
}
