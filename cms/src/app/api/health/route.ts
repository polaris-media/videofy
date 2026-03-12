export const GET = async () =>
  new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });

export const revalidate = 0;
