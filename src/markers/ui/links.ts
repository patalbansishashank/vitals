/**
 * Where the marker chips link to: the Evidence topic "Blood markers and diet" and the markers chapter of the intake
 * (a marker row in change mode).
 */
import { markerEvidenceHref, topicHref } from '@/features/evidence/links';
import type { MarkerId } from '../types';

export const MARKERS_TOPIC_SLUG = 'blood-markers-and-diet';

/** Evidence › Blood markers and diet; with a marker, that marker's section of the topic. */
export const markersTopicHref = (markerId?: MarkerId): string => (markerId ? markerEvidenceHref(markerId) : topicHref(MARKERS_TOPIC_SLUG));

/** The intake's markers chapter (`/onboarding/markers`); with a marker, its row opens in change mode. */
export const markersChapterHref = (markerId?: MarkerId): string => `/onboarding/markers${markerId ? `?edit=${encodeURIComponent(markerId)}#marker-${markerId}` : ''}`;
