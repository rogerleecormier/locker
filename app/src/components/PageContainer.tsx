import * as React from "react";
import { cn } from "~/lib/utils";

interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PageContainer({ children, className, ...props }: PageContainerProps) {
  return (
    <div
      className={cn(
        "w-full max-w-[1400px] mx-auto px-4 py-6 md:px-8 md:py-8 flex flex-col gap-6 md:gap-8",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
