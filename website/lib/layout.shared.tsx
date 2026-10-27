import Image from "next/image";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, githubUrl, withBasePath } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Image src={withBasePath("/logo.svg")} alt="" width={24} height={24} />
          <span className="font-semibold tracking-tight">{appName}</span>
        </>
      ),
    },
    links: [
      { text: "Docs", url: "/docs", active: "nested-url" },
    ],
    githubUrl,
  };
}
