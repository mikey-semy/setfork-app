// Dev-фолбэк: вход как общий demo-пользователь (когда нет GitHub OAuth-приложения).
import { NextResponse, type NextRequest } from "next/server";
import { getOrCreateDemoUser } from "@/shared/auth/users";
import { startSession } from "@/shared/auth/session";
import { demoLoginEnabled } from "@/shared/auth/oauth";
import { crossOriginBlock } from "@/shared/csrf";

export async function POST(req: NextRequest) {
  const blocked = crossOriginBlock(req);
  if (blocked) return blocked;
  // Скрыть кнопку в UI недостаточно: без этой проверки demo-вход остаётся
  // доступен прямым POST. См. demoLoginEnabled (AUTH_DISABLED_PROVIDERS=...,demo).
  if (!demoLoginEnabled()) {
    return new NextResponse(null, {
      status: 303,
      headers: { Location: "/login?e=oauth_off" },
    });
  }
  const session = await getOrCreateDemoUser();
  await startSession(session);
  // Относительный Location: браузер резолвит к своему origin (напр. https://sethub.ru).
  // Абсолютный из req.url за прокси утекал внутренним 0.0.0.0:3000 (standalone-сервер).
  return new NextResponse(null, { status: 303, headers: { Location: "/" } });
}
