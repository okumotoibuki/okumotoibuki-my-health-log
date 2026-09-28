-- このアプリは PostgREST（REST）だけを使う。GraphQL はテーブル構成を外から見えるようにするだけなので止める。
drop extension if exists pg_graphql;
