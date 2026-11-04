import { useQuery } from "@tanstack/react-query";
import { FEEDBACK_QUERY_KEY, listFeedback } from "@/lib/feedback";
import { feedbackCollection } from "@/storage/collections";
import { useAppCollection, useInvalidateOnChange } from "@/storage/hooks";

/** Number of open feedback items, for the tab badge. Shares the panel's query. */
export function useOpenFeedbackCount(): number | undefined {
  const collection = useAppCollection(feedbackCollection);
  useInvalidateOnChange(collection, FEEDBACK_QUERY_KEY);
  const query = useQuery({
    queryKey: FEEDBACK_QUERY_KEY,
    queryFn: () => listFeedback(collection),
    select: (items) => items.filter((item) => item.status === "open").length,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return query.data;
}
