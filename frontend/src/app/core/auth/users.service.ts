import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

import type {
  Paginated,
  Role,
  User,
  UserResponse,
  UserStatus,
  UsersListParams,
} from './auth.models';
import { AuthService } from './auth.service';

const API = '/api/v1/users';

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  getMe(): Observable<User> {
    return this.http.get<UserResponse>(`${API}/me`).pipe(
      tap((res) => this.auth.setUser(res.user)),
      map((res) => res.user),
    );
  }

  updateMe(payload: { nome?: string; email?: string }): Observable<User> {
    return this.http.patch<UserResponse>(`${API}/me`, payload).pipe(
      tap((res) => this.auth.setUser(res.user)),
      map((res) => res.user),
    );
  }

  changePassword(senhaAtual: string, senhaNova: string): Observable<void> {
    return this.http.post<void>(`${API}/me/password`, { senhaAtual, senhaNova });
  }

  list(params: UsersListParams): Observable<Paginated<User>> {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    }
    return this.http.get<Paginated<User>>(API, { params: httpParams });
  }

  adminUpdate(id: string, payload: { role?: Role; status?: UserStatus }): Observable<User> {
    return this.http.patch<UserResponse>(`${API}/${id}`, payload).pipe(map((res) => res.user));
  }
}
