import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { avatarColor, initials } from "@/lib/work-items-data";
import { isUnassignedPersonName } from "@/lib/person-display";
import { cn } from "@/lib/utils";

/**
 * Real profile photo when available, with a deterministic initials fallback.
 * A photo that fails to decode also falls back so broken images never linger.
 */
export function PersonAvatar({
  name,
  photoUrl,
  className,
}: {
  name: string;
  photoUrl?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  const unassigned = isUnassignedPersonName(name);
  const showPhoto = !unassigned && Boolean(photoUrl) && !failed;

  return (
    <span
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden text-[9px] font-semibold ring-1 ring-black/50",
        unassigned
          ? "bg-[#d8d8d8] text-[#606060]"
          : showPhoto
            ? "bg-[#c0c0c0] text-white"
            : cn(avatarColor(name), "text-white"),
        className,
      )}
    >
      {unassigned ? (
        <UserRound className="h-[72%] w-[72%]" aria-hidden="true" />
      ) : showPhoto ? (
        <img
          src={photoUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
