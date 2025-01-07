import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const data = {
      airQuality: 250,
      noiseLevel: 60,
      crowdingLevel: 68,
      greenSpaceUsage: 78,
    };

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch environmental metrics" },
      { status: 500 }
    );
  }
}
