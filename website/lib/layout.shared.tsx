import Image from "next/image";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, githubUrl } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Image src="/logo.svg" alt="" width={24} height={24} />
          <span className="font-semibold tracking-tight">{appName}</span>
        </>
      ),
    },
    links: [
      { text: "Docs", url: "/docs", active: "nested-url" },
      { text: "Roadmap", url: `${githubUrl}/blob/main/ROADMAP.md`, external: true },
    ],
    githubUrl,
  };
}
