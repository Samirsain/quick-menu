import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Feedback {
  id: string;
  order_id: string;
  rating: number;
  comment: string;
  created_at: string;
  orders: {
    order_number: string;
    table_number: string;
  } | null;
}

interface FeedbackViewProps {
  restaurantId: string;
}

const FeedbackView = ({ restaurantId }: FeedbackViewProps) => {
  const { toast } = useToast();
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFeedback();
  }, [restaurantId]);

  const fetchFeedback = async () => {
    try {
      const { data, error } = await supabase
        .from("feedback")
        .select(`
          *,
          orders (
            order_number,
            table_number
          )
        `)
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setFeedback(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load feedback",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${
              star <= rating
                ? "fill-primary text-primary"
                : "fill-muted text-muted"
            }`}
          />
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-5">
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-16 ml-auto" />
                </div>
              </div>
              <Skeleton className="h-16 w-full mt-4 rounded-lg" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight mb-1">Customer feedback</h2>
        <p className="text-sm text-muted-foreground">View feedback from your customers</p>
      </div>

      <div className="grid gap-4">
        {feedback.map((item) => (
          <Card key={item.id}>
            <CardHeader className="p-5">
              <div className="flex justify-between items-start gap-4">
                <div>
                  {/* The order can be gone (deleted or cleaned up); keep the feedback readable */}
                  <CardTitle className="font-display text-xl font-normal tracking-normal">
                    {item.orders ? `Order #${item.orders.order_number}` : "Order removed"}
                  </CardTitle>
                  {item.orders && (
                    <p className="text-sm text-muted-foreground">
                      Table {item.orders.table_number}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  {renderStars(item.rating)}
                  <p className="text-xs text-muted-foreground mt-2 tabular-nums">
                    {new Date(item.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
              </div>
            </CardHeader>
            {item.comment && (
              <CardContent className="p-5 pt-0">
                <div className="bg-muted/30 rounded-xl p-4">
                  <p className="text-sm text-foreground/80">
                    “{item.comment}”
                  </p>
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {feedback.length === 0 && (
        <Card className="p-12 text-center">
          <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">No feedback yet</p>
          <p className="text-sm text-muted-foreground mt-2">
            Customer feedback will appear here after orders are completed
          </p>
        </Card>
      )}
    </div>
  );
};

export default FeedbackView;