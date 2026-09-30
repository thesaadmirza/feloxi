"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const MENU_CONTENT =
  "z-50 min-w-[200px] rounded-xl border border-line-strong bg-raised p-1 text-[13px] text-foreground shadow-float";
export const MENU_ITEM =
  "flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2.5 outline-none select-none data-[highlighted]:bg-hover data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-t3";

export const Menu = Dropdown.Root;
export const MenuTrigger = Dropdown.Trigger;
export const MenuRadioGroup = Dropdown.RadioGroup;
export const MenuItemIndicator = Dropdown.ItemIndicator;

export function MenuContent({
  className,
  align = "end",
  sideOffset = 6,
  ...props
}: Dropdown.DropdownMenuContentProps) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(MENU_CONTENT, className)}
        {...props}
      />
    </Dropdown.Portal>
  );
}

export function MenuItem({ className, ...props }: Dropdown.DropdownMenuItemProps) {
  return <Dropdown.Item className={cn(MENU_ITEM, className)} {...props} />;
}

export function MenuRadioItem({ className, ...props }: Dropdown.DropdownMenuRadioItemProps) {
  return <Dropdown.RadioItem className={cn(MENU_ITEM, className)} {...props} />;
}

export function MenuLabel({ className, ...props }: Dropdown.DropdownMenuLabelProps) {
  return <Dropdown.Label className={cn("label px-2.5 pt-2 pb-1.5", className)} {...props} />;
}

export function MenuSeparator() {
  return <Dropdown.Separator className="my-1 h-px bg-border" />;
}
