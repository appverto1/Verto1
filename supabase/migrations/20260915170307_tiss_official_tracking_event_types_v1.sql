-- Issue #170 / contract v4 / H22 Data gate.
-- Additive event types required by the atomic TISS-06 mutation boundary.

alter table public.tiss_official_tracking_events
  drop constraint if exists tiss_official_tracking_events_type_check;

alter table public.tiss_official_tracking_events
  add constraint tiss_official_tracking_events_type_check check (
    event_type in (
      'official_xml_tracking_created',
      'official_xml_marked_sent',
      'official_xml_protocol_registered',
      'official_xml_return_registered',
      'official_xml_guide_paid',
      'official_xml_guide_partially_paid',
      'official_xml_guide_glossed',
      'official_xml_guide_rejected',
      'official_xml_guide_updated',
      'official_xml_appeal_prepared',
      'official_xml_appeal_sent',
      'official_xml_appeal_resolved',
      'official_xml_tracking_note_added',
      'official_xml_replaced'
    )
  );
