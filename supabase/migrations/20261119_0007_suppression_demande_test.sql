-- Demande de congé de test (CP du 10 au 13/12/2026, faite le 19/11/2026) supprimée à la demande du développeur.
-- Les jours de congé posés par cette demande (aucun à ce jour) sont retirés avec elle ; le solde CP suit les jours posés.
delete from public.shifts where request_id = 'a94b8643-7028-4d2d-aaf8-af877b7fea0f';
delete from public.requests where id = 'a94b8643-7028-4d2d-aaf8-af877b7fea0f' and type = 'cp' and start_date = '2026-12-10' and end_date = '2026-12-13';
