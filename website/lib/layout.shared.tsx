import { LogoLockup } from "@/components/logo-lockup";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { githubUrl } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <LogoLockup className="h-5 w-auto" />,
    },
    links: [
      { text: "Docs", url: "/docs", active: "nested-url" },
    ],
    githubUrl,
  };
}
